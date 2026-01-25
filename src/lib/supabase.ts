import { createClient } from '@supabase/supabase-js'

// Estas variables se llenarán una vez creado el proyecto en la nube
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://tu-proyecto.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'tu-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Estructura de tablas sugerida:
/*
  Table: profiles
    - id: uuid (matches auth.users.id)
    - username: text
    - avatar_url: text
    - status: text (online, idle, dnd, offline)

  Table: channels
    - id: uuid
    - name: text
    - type: text (text, voice)
    - last_message: timestamp

  Table: messages
    - id: uuid
    - channel_id: uuid
    - profile_id: uuid
    - content: text
    - created_at: timestamp
*/
