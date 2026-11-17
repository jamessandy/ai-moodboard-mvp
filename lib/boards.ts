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

export type BoardSummary = Pick<
  StoredBoard,
  'id' | 'title' | 'brief' | 'share_id' | 'created_at' | 'updated_at'
>

export type BoardSavePayload = {
  title?: string
  brief: string
  document: unknown
}
