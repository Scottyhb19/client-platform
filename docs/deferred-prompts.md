# Deferred prompts

Self-contained prompts for work that's been scoped but not yet built.
Paste any block as the first message to a fresh Claude session and it
will have everything it needs to act cold — no conversation history
required.

Order in this file is rough priority. Pick whatever's blocking you.

---

## 1. Reject "owner-as-client" invites with a pre-check

```
The "Invite a client" form currently lets a practitioner invite their OWN
email as a client. This is logically nonsensical (you can't be your own
client) and creates a confusing failure mode. Add a pre-check.

In src/app/(staff)/clients/new/actions.ts (the inviteClientAction
function), before the clients table INSERT:

1. If the submitted email matches the calling user's own email
   (available from requireRole's auth context), reject with:
   "You can't invite your own email as a client. Use a different
   address."

2. Else, query user_organization_roles JOIN user_profiles to find any
   user in the SAME organization with that email. If found and their
   role is 'owner' or 'staff', reject with:
   "This email belongs to a practitioner in your practice. Clients need
   a separate email."

Both rejections should set fieldErrors.email so the message renders
under the Email field, NOT as a top-level alert. Match the existing
fieldErrors shape (look at the email validation block above).

Don't pre-check against clients in OTHER organizations — clients can
legitimately be in multiple practices. Don't pre-check against existing
auth.users either — the magic-link fallback already handles that case.

Run npm run type-check, commit "Invite: reject owner-as-client with
friendly pre-check", push.
```

---

## 2. Click-through gate to defeat Gmail link prefetch

```
Gmail's spam scanner pre-fetches every URL in incoming emails to scan
for malware. For magic-link / invite emails this consumes the one-time
token before the user clicks. The result is "otp_expired" errors for
any client whose email provider does aggressive prefetching (Gmail,
sometimes Yahoo).

Build a click-through gate so the URL in the email points to OUR domain,
not Supabase's verify endpoint. Only an actual user click reaches the
real action_link.

Architecture:
1. New migration: table `invite_tokens` with columns
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     organization_id uuid NOT NULL REFERENCES organizations(id),
     client_id uuid NOT NULL REFERENCES clients(id),
     action_link text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz NOT NULL,
     consumed_at timestamptz
   Index on (id) WHERE consumed_at IS NULL AND expires_at > now()
   RLS: deny all from authenticated. The route handler accesses via
   the service-role client.

2. New route: src/app/i/[id]/page.tsx
   - Server component that looks up the invite_tokens row by id
   - If not found / consumed / expired: render an error page
   - If valid: render a small page with a button "Continue to your
     portal" that does a client-side window.location.assign(action_link)
     (NOT an auto-redirect — the click is what defeats prefetch)
   - Don't mark consumed at all on click; rely on expires_at (8 hours).
     Simpler than tracking burned tokens.

3. Update src/app/(staff)/clients/new/actions.ts:
   - After getting action_link from generateLink, INSERT an
     invite_tokens row with that action_link
   - Pass the short URL `${proto}://${host}/i/${tokenId}` to
     sendClientInviteEmail instead of the raw action_link

4. Email template doesn't need changes — it just receives a different
   URL string.

Existing migration patterns are in supabase/migrations/. Match the
style: explicit RLS comments, audit-friendly columns, partial index
where appropriate.

Test by inviting a Gmail address — should now reach /welcome instead of
expiring.

Reference docs/schema.md for the conventions in this codebase. Run
type-check + supabase migration push, commit per project style, push.
```

---

## 3. Migrate to Supabase's new Publishable/Secret API keys

```
My Supabase project (azjllcsffixswiigjqhj) currently uses the legacy
JWT-based API keys: NEXT_PUBLIC_SUPABASE_ANON_KEY and
SUPABASE_SERVICE_ROLE_KEY. Supabase has rolled out a new key system
("Publishable" + "Secret") and removed rotation from the legacy keys,
so the right move is to migrate.

The app is a Next.js 16 + Supabase project deployed to Vercel at
https://client-platform-wine.vercel.app/. Local repo at
C:\Users\scott\Desktop\Client Software Platform — secrets in .env.local.

Walk me through (I'm not a developer):

1. Generating new Publishable + Secret keys in the Supabase dashboard
   (Project Settings → API Keys, the "new" section above the legacy one).

2. Deciding what env-var name to use. The codebase reads
   NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in
   src/lib/supabase/server.ts and src/lib/supabase/client.ts. Either:
     (a) Reuse the existing names, just paste new values — fewer changes.
     (b) Rename to NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY +
         SUPABASE_SECRET_KEY for clarity — touches src files too.
   Recommend whichever is safer and explain why.

3. Updating .env.local with the new keys.

4. Updating the same env vars in Vercel (Project Settings →
   Environment Variables → edit each → Save).

5. Triggering a Vercel redeploy so the new values take effect
   (Deployments tab → latest → Redeploy, untick build cache).

6. Restarting the local dev server to pick up new .env.local values.

7. Verifying both prod and local still work — log in, archive a
   client (which uses the service-role / secret key), confirm no
   "row-level security" errors.

8. Once verified working, optionally clicking "Disable JWT-based API
   Keys" in Supabase to retire the legacy keys. Explain the risk
   (anything else still using the old keys breaks instantly) and how
   to confirm nothing depends on them before flipping it.

If anything fails at any step, diagnose by reading errors directly
(Vercel build logs, browser console, dev server terminal) and tell me
what to do. Don't retry blindly.
```

---

## 4. Custom domain + Vercel hookup

```
I want to put my Vercel-deployed Next.js app onto a custom domain instead
of the default vercel.app subdomain. The app is at
https://client-platform-wine.vercel.app/ and the Vercel project is
"client-platform" under the "scottyhb19s-projects" team (Hobby plan).

Walk me through (I'm not a developer):

1. Buying an Australian domain. Recommend a registrar that has clean DNS
   management UX for Vercel hookup. Cheapest isn't best — easiest is.
   I want to use one of these names if available:
     - odyssey.com.au (preferred but probably taken)
     - odysseyhealth.com.au
     - odysseyep.com.au
     - tryodyssey.com.au
   Tell me how to check availability and where to buy.

2. Adding the domain to my Vercel project (Settings → Domains).

3. Setting the DNS records at the registrar to point at Vercel. Vercel
   shows you what records to add — translate them into where to click in
   the registrar's dashboard.

4. Verifying SSL certificate provisions automatically (Vercel does this
   for free via Let's Encrypt).

5. Updating Supabase's allowed Redirect URLs to include the new domain
   alongside the existing Vercel URL. Project URL config is at
   https://supabase.com/dashboard/project/azjllcsffixswiigjqhj/auth/url-configuration

6. Updating the email "from" address. Currently using
   onboarding@resend.dev (sandbox). With a real domain I can verify it
   at Resend and send from invites@<my-domain>. Walk me through the
   Resend domain verification (DNS records again).

Be specific about UI clicks, what dialog to look at, what dropdowns to
change. I have screenshots of dashboards but want clear written steps.

If any DNS record fails to propagate, diagnose by reading the records
back (dig / nslookup or the registrar's UI) and tell me what to do.
Don't just retry blindly.
```

---

## 5. Replace the text logo with a real wordmark + icon

```
The Odyssey app currently uses a text-only "Odyssey." brand (Barlow
Condensed font, with a green-accent period) wherever the logo appears.
The places it shows up:

- Top-left of the staff TopBar: src/app/(staff)/_components/TopBar.tsx
- Left brand panel of the auth shell:
  src/components/auth/AuthShell.tsx (the giant 110px Odyssey)
- The mobile-only fallback in AuthShell.tsx
- The PWA install icon (currently ./icon.svg in public/manifest.json)
- The decorative SVG in the deck cover (not user-facing in the live app)

I want to replace the text-only treatment with a real logo — likely a
small wordmark + icon. I have a logo file (or want to commission one).

Walk me through:

1. What file formats I should provide (SVG for the wordmark, PNG for
   the iOS PWA icons in 180x180 + 192x192 + 512x512).
2. Where to put them in the public/ directory.
3. Updating the React components to use <img src=...> or inline SVG
   instead of the current text spans, while keeping the same visual
   weight (the giant 110px text is load-bearing in the auth shell — a
   tiny logo would look wrong in that slot).
4. Updating manifest.json with the new icons.
5. The favicon (browser tab icon) — currently a Next.js default. Replace
   with the Odyssey icon at multiple sizes.

If I don't have a logo yet, recommend either an AI tool to generate
something brand-appropriate, or a quick approach to mock one up
(e.g., a simple mark in Figma).

Don't just dump the new components — show me before/after for each
file so I can see what changed.
```

---

## 6. Polish the PWA name and icons

```
Audit and improve the PWA install experience for my Next.js app. The
manifest is at public/manifest.json. Currently:

- name: "Odyssey"
- short_name: "Odyssey"
- icon: /icon.svg
- theme_color: #1E1A18

Walk me through (I'm not a developer):

1. Reviewing the current manifest fields and what each does. Explain
   what shows up where on iOS vs Android home screens, splash screens,
   and the PWA install prompt.

2. Adding the missing icon sizes that iOS Safari needs for a polished
   install (180x180 apple-touch-icon, 192x192, 512x512, maskable
   variant).

3. Setting "categories" appropriately (this is a healthcare /
   exercise-physiology app).

4. Confirming the splash screen looks right on iOS install — iOS
   generates one from background_color and the icon, no extra config.

5. Testing the install on a real iPhone. The install screen lives at
   /welcome/install — verify the manifest is wired such that "Add to
   Home Screen" gives a clean icon, name, and full-screen launch.

If I don't have a real logo yet, scaffold the icon files from a
placeholder so the install path works end-to-end now and I can swap
in a real logo later.
```

---

## Loose ends (small fixes, not full prompts)

- **Portal greeting date off-by-one** — On iPhone the greeting line shows
  "SAT, 25 APR" while the week strip correctly highlights "Su 26" as
  today. Likely a timezone math difference between the two date sources
  in src/app/portal/page.tsx and the TodayScreen client component.
  Worth a 5-line fix when convenient.
