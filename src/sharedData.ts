import { createClient } from '@supabase/supabase-js'

export type SharedKind = 'member' | 'tournament'
export type SharedRecord = {
  id: string
  kind: SharedKind
  data: unknown | null
  deleted: boolean
}
export type SharedHistoryRecord = {
  id: string
  kind: SharedKind
  record_id: string
  action: 'created' | 'updated' | 'deleted'
  before_data: unknown | null
  after_data: unknown | null
  changed_at: string
}
export type SharedState = {
  members: unknown[]
  tournaments: unknown[]
}

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = url && anonKey ? createClient(url, anonKey) : null

export const isCloudConfigured = Boolean(supabase)

function toRecords(state: SharedState): SharedRecord[] {
  return [
    ...state.members.map((data) => ({ id: (data as { id: string }).id, kind: 'member' as const, data, deleted: false })),
    ...state.tournaments.map((data) => ({ id: (data as { id: string }).id, kind: 'tournament' as const, data, deleted: false })),
  ]
}

function fromRecords(records: SharedRecord[]): SharedState {
  return {
    members: records.filter(record => record.kind === 'member' && !record.deleted).flatMap(record => record.data === null ? [] : [record.data]),
    tournaments: records.filter(record => record.kind === 'tournament' && !record.deleted).flatMap(record => record.data === null ? [] : [record.data]),
  }
}

export async function loadSharedState(fallback: SharedState): Promise<SharedState> {
  if (!supabase) return fallback
  const result = await supabase.from('court_records').select('id, kind, data, deleted')
  if (result.error) throw result.error
  const records = (result.data ?? []) as SharedRecord[]
  if (records.length === 0) {
    const seed = toRecords(fallback)
    if (seed.length) {
      const inserted = await supabase.from('court_records').upsert(seed, {
        onConflict: 'kind,id',
        ignoreDuplicates: true,
      })
      if (inserted.error) throw inserted.error
    }
    const refreshed = await supabase.from('court_records').select('id, kind, data, deleted')
    if (refreshed.error) throw refreshed.error
    return fromRecords((refreshed.data ?? []) as SharedRecord[])
  }
  return fromRecords(records)
}

export async function saveSharedRecords(records: SharedRecord[], history: SharedHistoryRecord[] = []) {
  if (!supabase || records.length === 0) return
  if (history.length) {
    const historyResult = await supabase.from('court_record_history').insert(history)
    if (historyResult.error) throw historyResult.error
  }
  const result = await supabase.from('court_records').upsert(records, { onConflict: 'kind,id' })
  if (result.error) throw result.error
}

export function subscribeToSharedRecords(onRecord: (record: SharedRecord) => void) {
  if (!supabase) return () => {}
  const channel = supabase
    .channel('court-shared-records')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'court_records' }, payload => {
      if (payload.eventType === 'DELETE') {
        const old = payload.old as Partial<SharedRecord>
        if (old.id && (old.kind === 'member' || old.kind === 'tournament')) {
          onRecord({ id: old.id, kind: old.kind, data: null, deleted: true })
        }
        return
      }
      const record = payload.new as SharedRecord
      if (record.id && (record.kind === 'member' || record.kind === 'tournament')) onRecord(record)
    })
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}
