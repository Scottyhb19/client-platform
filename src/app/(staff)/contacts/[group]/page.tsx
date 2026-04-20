import { PlaceholderPage } from '../../_components/PlaceholderPage'

const GROUP_LABELS: Record<string, string> = {
  gps: 'General Practitioners',
  surgeons: 'Surgeons',
  'sports-doc': 'Sports Doctors',
  physios: 'Physiotherapists',
  chiros: 'Chiropractors',
  eps: 'Exercise Physiologists',
}

export default async function ContactsGroupPage({
  params,
}: {
  params: Promise<{ group: string }>
}) {
  const { group } = await params
  const label = GROUP_LABELS[group] ?? 'Contacts'

  return (
    <PlaceholderPage
      eyebrow="04 Contacts"
      title={label}
      description="Filtered view — referral sub-group."
    />
  )
}
