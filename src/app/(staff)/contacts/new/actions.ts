'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isContactGroup } from '../_lib/groups'
import type { NewContactState } from './types'

export async function createContactAction(
  _prev: NewContactState,
  formData: FormData,
): Promise<NewContactState> {
  const { organizationId } = await requireRole(['owner', 'staff'])

  const name = (formData.get('name') ?? '').toString().trim()
  const contactGroup = (formData.get('contact_group') ?? '').toString()
  const practice = toNullable(formData.get('practice'))
  const phone = toNullable(formData.get('phone'))
  const email = toNullable(formData.get('email'))
  const notes = toNullable(formData.get('notes'))
  const tagsRaw = (formData.get('tags') ?? '').toString()
  const tags = tagsRaw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const fieldErrors: NewContactState['fieldErrors'] = {}
  if (!name) fieldErrors.name = 'Required.'
  if (!contactGroup || !isContactGroup(contactGroup)) {
    fieldErrors.contact_group = 'Pick a discipline.'
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('contacts').insert({
    organization_id: organizationId,
    name,
    contact_group: contactGroup,
    practice,
    phone,
    email,
    notes,
    tags,
  })

  if (error) {
    return {
      error: `Failed to create contact: ${error.message}`,
      fieldErrors: {},
    }
  }

  revalidatePath('/contacts')
  redirect('/contacts')
}

function toNullable(value: FormDataEntryValue | null): string | null {
  if (value === null) return null
  const s = value.toString().trim()
  return s.length === 0 ? null : s
}
