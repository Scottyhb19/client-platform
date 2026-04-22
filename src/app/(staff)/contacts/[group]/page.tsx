import { renderContactsPage } from '../page'

export const dynamic = 'force-dynamic'

export default async function ContactsGroupPage({
  params,
}: {
  params: Promise<{ group: string }>
}) {
  const { group } = await params
  return await renderContactsPage(group)
}
