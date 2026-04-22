import { PortalEmpty, PortalTop } from '../_components/PortalTop'

export const dynamic = 'force-dynamic'

export default function PortalBookPage() {
  return (
    <>
      <PortalTop title="Book" greeting="Find a time" />
      <PortalEmpty
        title="Online booking coming next"
        message="Once your EP sets their weekly availability in Settings, open slots will show up here — one tap to book."
      />
    </>
  )
}
