import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public routes — no auth required
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
]);

// Staff-only routes
const isStaffRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/clients(.*)",
  "/exercises(.*)",
  "/programs(.*)",
  "/schedule(.*)",
  "/settings(.*)",
  "/api/clients(.*)",
  "/api/exercises(.*)",
  "/api/programs(.*)",
  "/api/sessions(.*)",
  "/api/bookings(.*)",
  "/api/notes(.*)",
  "/api/communications(.*)",
]);

// Client portal routes
const isPortalRoute = createRouteMatcher([
  "/program(.*)",
  "/reports(.*)",
  "/bookings(.*)",
]);

export const proxy = clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  // Allow public routes through
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to sign-in
  if (!userId) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", req.url);
    return NextResponse.redirect(signInUrl);
  }

  // Authenticated users can access everything for now.
  // Role-based routing will be enforced once Clerk roles are configured.
  // When that's ready, uncomment and configure session claims:
  //
  // const role = (sessionClaims?.metadata as { role?: string })?.role;
  // if (isStaffRoute(req) && role !== "staff") {
  //   return NextResponse.redirect(new URL("/program", req.url));
  // }
  // if (isPortalRoute(req) && role !== "client" && role !== "staff") {
  //   return NextResponse.redirect(new URL("/sign-in", req.url));
  // }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
