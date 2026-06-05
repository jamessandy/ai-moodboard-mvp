export type StoredBoard = {
  id: string
  owner_id?: string
  title: string
  brief: string
  document: unknown
  share_id: string
  created_at?: string
  updated_at?: string
}

export type BoardSavePayload = {
  brief: string
  document: unknown
}
