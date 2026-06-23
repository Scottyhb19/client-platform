export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appointment_reminders: {
        Row: {
          appointment_id: string
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          failure_reason: string | null
          id: string
          provider: string
          provider_message_id: string | null
          reminder_type: Database["public"]["Enums"]["appointment_reminder_type"]
          retry_count: number
          scheduled_for: string
          sent_at: string | null
          status: Database["public"]["Enums"]["appointment_reminder_status"]
          updated_at: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          provider: string
          provider_message_id?: string | null
          reminder_type: Database["public"]["Enums"]["appointment_reminder_type"]
          retry_count?: number
          scheduled_for: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["appointment_reminder_status"]
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          provider?: string
          provider_message_id?: string | null
          reminder_type?: Database["public"]["Enums"]["appointment_reminder_type"]
          retry_count?: number
          scheduled_for?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["appointment_reminder_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reminders_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_type: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by_role: string | null
          client_id: string | null
          confirmed_at: string | null
          created_at: string
          created_by_role: string
          deleted_at: string | null
          end_at: string
          id: string
          kind: string
          location: string | null
          no_show_marked_at: string | null
          notes: string | null
          organization_id: string
          staff_user_id: string
          start_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          appointment_type?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_role?: string | null
          client_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by_role?: string
          deleted_at?: string | null
          end_at: string
          id?: string
          kind?: string
          location?: string | null
          no_show_marked_at?: string | null
          notes?: string | null
          organization_id: string
          staff_user_id: string
          start_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          appointment_type?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_role?: string | null
          client_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by_role?: string
          deleted_at?: string | null
          end_at?: string
          id?: string
          kind?: string
          location?: string | null
          no_show_marked_at?: string | null
          notes?: string | null
          organization_id?: string
          staff_user_id?: string
          start_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      assessment_templates: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          schema_json: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          schema_json?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          schema_json?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          author_user_id: string
          client_id: string
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          id: string
          organization_id: string
          responses_json: Json
          status: Database["public"]["Enums"]["assessment_status"]
          template_id: string
          updated_at: string
          version: number
        }
        Insert: {
          author_user_id: string
          client_id: string
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          responses_json?: Json
          status?: Database["public"]["Enums"]["assessment_status"]
          template_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          author_user_id?: string
          client_id?: string
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          responses_json?: Json
          status?: Database["public"]["Enums"]["assessment_status"]
          template_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "assessments_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "assessments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "assessment_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_role: string | null
          actor_user_id: string | null
          body_size_bytes: number | null
          changed_at: string
          changed_fields: string[] | null
          id: string
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          organization_id: string | null
          request_id: string | null
          row_id: string
          table_name: string
          user_agent: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_role?: string | null
          actor_user_id?: string | null
          body_size_bytes?: number | null
          changed_at?: string
          changed_fields?: string[] | null
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          organization_id?: string | null
          request_id?: string | null
          row_id: string
          table_name: string
          user_agent?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_role?: string | null
          actor_user_id?: string | null
          body_size_bytes?: number | null
          changed_at?: string
          changed_fields?: string[] | null
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          organization_id?: string | null
          request_id?: string | null
          row_id?: string
          table_name?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_wide_column_config: {
        Row: {
          column_name: string
          table_name: string
        }
        Insert: {
          column_name: string
          table_name: string
        }
        Update: {
          column_name?: string
          table_name?: string
        }
        Relationships: []
      }
      availability_rules: {
        Row: {
          created_at: string
          day_of_week: number | null
          deleted_at: string | null
          effective_from: string
          effective_to: string | null
          end_time: string
          id: string
          is_blocked: boolean
          notes: string | null
          organization_id: string
          recurrence: Database["public"]["Enums"]["availability_recurrence"]
          slot_duration_minutes: number
          specific_date: string | null
          staff_user_id: string
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week?: number | null
          deleted_at?: string | null
          effective_from?: string
          effective_to?: string | null
          end_time: string
          id?: string
          is_blocked?: boolean
          notes?: string | null
          organization_id: string
          recurrence: Database["public"]["Enums"]["availability_recurrence"]
          slot_duration_minutes?: number
          specific_date?: string | null
          staff_user_id: string
          start_time: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number | null
          deleted_at?: string | null
          effective_from?: string
          effective_to?: string | null
          end_time?: string
          id?: string
          is_blocked?: boolean
          notes?: string | null
          organization_id?: string
          recurrence?: Database["public"]["Enums"]["availability_recurrence"]
          slot_duration_minutes?: number
          specific_date?: string | null
          staff_user_id?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_rules_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      calendar_feed_tokens: {
        Row: {
          created_at: string
          staff_user_id: string
          token: string
        }
        Insert: {
          created_at?: string
          staff_user_id: string
          token: string
        }
        Update: {
          created_at?: string
          staff_user_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feed_tokens_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      circuit_exercise_sets: {
        Row: {
          circuit_exercise_id: string
          created_at: string
          deleted_at: string | null
          id: string
          optional_metric: string | null
          optional_value: string | null
          rep_metric: string | null
          reps: string | null
          set_number: number
          updated_at: string
        }
        Insert: {
          circuit_exercise_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          optional_metric?: string | null
          optional_value?: string | null
          rep_metric?: string | null
          reps?: string | null
          set_number: number
          updated_at?: string
        }
        Update: {
          circuit_exercise_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          optional_metric?: string | null
          optional_value?: string | null
          rep_metric?: string | null
          reps?: string | null
          set_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "circuit_exercise_sets_circuit_exercise_id_fkey"
            columns: ["circuit_exercise_id"]
            isOneToOne: false
            referencedRelation: "circuit_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      circuit_exercises: {
        Row: {
          circuit_id: string
          created_at: string
          deleted_at: string | null
          exercise_id: string
          id: string
          instructions: string | null
          optional_metric: string | null
          optional_value: string | null
          reps: string | null
          rest_seconds: number | null
          rpe: number | null
          sets: number | null
          sort_order: number
          tempo: string | null
          updated_at: string
        }
        Insert: {
          circuit_id: string
          created_at?: string
          deleted_at?: string | null
          exercise_id: string
          id?: string
          instructions?: string | null
          optional_metric?: string | null
          optional_value?: string | null
          reps?: string | null
          rest_seconds?: number | null
          rpe?: number | null
          sets?: number | null
          sort_order?: number
          tempo?: string | null
          updated_at?: string
        }
        Update: {
          circuit_id?: string
          created_at?: string
          deleted_at?: string | null
          exercise_id?: string
          id?: string
          instructions?: string | null
          optional_metric?: string | null
          optional_value?: string | null
          reps?: string | null
          rest_seconds?: number | null
          rpe?: number | null
          sets?: number | null
          sort_order?: number
          tempo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "circuit_exercises_circuit_id_fkey"
            columns: ["circuit_id"]
            isOneToOne: false
            referencedRelation: "circuits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "circuit_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      circuits: {
        Row: {
          circuit_type: string
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          circuit_type?: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          circuit_type?: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "circuits_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "circuits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_categories: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_files: {
        Row: {
          category: Database["public"]["Enums"]["file_category"]
          client_id: string
          created_at: string
          id: string
          mime_type: string | null
          name: string
          notes: string | null
          organization_id: string
          original_filename: string
          size_bytes: number
          storage_bucket: string
          storage_path: string
          updated_at: string
          uploaded_by_user_id: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["file_category"]
          client_id: string
          created_at?: string
          id?: string
          mime_type?: string | null
          name: string
          notes?: string | null
          organization_id: string
          original_filename: string
          size_bytes: number
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          uploaded_by_user_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["file_category"]
          client_id?: string
          created_at?: string
          id?: string
          mime_type?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          original_filename?: string
          size_bytes?: number
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          uploaded_by_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_files_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      client_medical_history: {
        Row: {
          client_id: string
          condition: string
          created_at: string
          deleted_at: string | null
          diagnosis_date: string | null
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          severity: number | null
          updated_at: string
        }
        Insert: {
          client_id: string
          condition: string
          created_at?: string
          deleted_at?: string | null
          diagnosis_date?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id: string
          severity?: number | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          condition?: string
          created_at?: string
          deleted_at?: string | null
          diagnosis_date?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          severity?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_medical_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_medical_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_publications: {
        Row: {
          created_at: string
          deleted_at: string | null
          framing_text: string | null
          id: string
          organization_id: string
          published_at: string
          published_by: string
          test_id: string
          test_session_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          framing_text?: string | null
          id?: string
          organization_id: string
          published_at?: string
          published_by: string
          test_id: string
          test_session_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          framing_text?: string | null
          id?: string
          organization_id?: string
          published_at?: string
          published_by?: string
          test_id?: string
          test_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_publications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_publications_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_publications_test_session_id_fkey"
            columns: ["test_session_id"]
            isOneToOne: false
            referencedRelation: "test_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          archived_at: string | null
          category_id: string | null
          created_at: string
          deleted_at: string | null
          dob: string | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          first_name: string
          gender: string | null
          goals: string | null
          id: string
          invited_at: string | null
          last_activity_at: string | null
          last_name: string
          onboarded_at: string | null
          organization_id: string
          phone: string | null
          referral_source: string | null
          referred_by: string | null
          updated_at: string
          user_id: string | null
          version: number
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          dob?: string | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          first_name: string
          gender?: string | null
          goals?: string | null
          id?: string
          invited_at?: string | null
          last_activity_at?: string | null
          last_name: string
          onboarded_at?: string | null
          organization_id: string
          phone?: string | null
          referral_source?: string | null
          referred_by?: string | null
          updated_at?: string
          user_id?: string | null
          version?: number
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          dob?: string | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          first_name?: string
          gender?: string | null
          goals?: string | null
          id?: string
          invited_at?: string | null
          last_activity_at?: string | null
          last_name?: string
          onboarded_at?: string | null
          organization_id?: string
          phone?: string | null
          referral_source?: string | null
          referred_by?: string | null
          updated_at?: string
          user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "clients_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "client_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      clinical_notes: {
        Row: {
          appointment_id: string | null
          assessment: string | null
          author_user_id: string
          body_rich: string | null
          client_id: string
          content_json: Json | null
          created_at: string
          deleted_at: string | null
          flag_body_region: string | null
          flag_resolved_at: string | null
          flag_reviewed_at: string | null
          flag_severity: number | null
          id: string
          is_pinned: boolean
          note_date: string
          note_type: Database["public"]["Enums"]["note_type"]
          objective: string | null
          organization_id: string
          plan: string | null
          subjective: string | null
          template_id: string | null
          test_session_id: string | null
          title: string | null
          updated_at: string
          version: number
        }
        Insert: {
          appointment_id?: string | null
          assessment?: string | null
          author_user_id: string
          body_rich?: string | null
          client_id: string
          content_json?: Json | null
          created_at?: string
          deleted_at?: string | null
          flag_body_region?: string | null
          flag_resolved_at?: string | null
          flag_reviewed_at?: string | null
          flag_severity?: number | null
          id?: string
          is_pinned?: boolean
          note_date?: string
          note_type?: Database["public"]["Enums"]["note_type"]
          objective?: string | null
          organization_id: string
          plan?: string | null
          subjective?: string | null
          template_id?: string | null
          test_session_id?: string | null
          title?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          appointment_id?: string | null
          assessment?: string | null
          author_user_id?: string
          body_rich?: string | null
          client_id?: string
          content_json?: Json | null
          created_at?: string
          deleted_at?: string | null
          flag_body_region?: string | null
          flag_resolved_at?: string | null
          flag_reviewed_at?: string | null
          flag_severity?: number | null
          id?: string
          is_pinned?: boolean
          note_date?: string
          note_type?: Database["public"]["Enums"]["note_type"]
          objective?: string | null
          organization_id?: string
          plan?: string | null
          subjective?: string | null
          template_id?: string | null
          test_session_id?: string | null
          title?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "clinical_notes_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_notes_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "clinical_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_notes_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "note_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_notes_test_session_id_fkey"
            columns: ["test_session_id"]
            isOneToOne: false
            referencedRelation: "test_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_templates: {
        Row: {
          body_template: string
          communication_type: Database["public"]["Enums"]["communication_type"]
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          subject_template: string | null
          updated_at: string
          variables_schema: Json
        }
        Insert: {
          body_template: string
          communication_type: Database["public"]["Enums"]["communication_type"]
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          subject_template?: string | null
          updated_at?: string
          variables_schema?: Json
        }
        Update: {
          body_template?: string
          communication_type?: Database["public"]["Enums"]["communication_type"]
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          subject_template?: string | null
          updated_at?: string
          variables_schema?: Json
        }
        Relationships: [
          {
            foreignKeyName: "communication_templates_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "communication_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      communications: {
        Row: {
          ai_approved_at: string | null
          ai_approved_by_user_id: string | null
          ai_draft: boolean
          body: string
          client_id: string
          communication_type: Database["public"]["Enums"]["communication_type"]
          created_at: string
          deleted_at: string | null
          delivered_at: string | null
          direction: Database["public"]["Enums"]["communication_direction"]
          failed_at: string | null
          failure_reason: string | null
          id: string
          organization_id: string
          provider: string | null
          provider_message_id: string | null
          recipient_email: string | null
          recipient_phone: string | null
          scheduled_for: string | null
          sender_user_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["communication_status"]
          subject: string | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          ai_approved_at?: string | null
          ai_approved_by_user_id?: string | null
          ai_draft?: boolean
          body: string
          client_id: string
          communication_type: Database["public"]["Enums"]["communication_type"]
          created_at?: string
          deleted_at?: string | null
          delivered_at?: string | null
          direction?: Database["public"]["Enums"]["communication_direction"]
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          organization_id: string
          provider?: string | null
          provider_message_id?: string | null
          recipient_email?: string | null
          recipient_phone?: string | null
          scheduled_for?: string | null
          sender_user_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["communication_status"]
          subject?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          ai_approved_at?: string | null
          ai_approved_by_user_id?: string | null
          ai_draft?: boolean
          body?: string
          client_id?: string
          communication_type?: Database["public"]["Enums"]["communication_type"]
          created_at?: string
          deleted_at?: string | null
          delivered_at?: string | null
          direction?: Database["public"]["Enums"]["communication_direction"]
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          organization_id?: string
          provider?: string | null
          provider_message_id?: string | null
          recipient_email?: string | null
          recipient_phone?: string | null
          scheduled_for?: string | null
          sender_user_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["communication_status"]
          subject?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communications_ai_approved_by_user_id_fkey"
            columns: ["ai_approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "communications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_sender_user_id_fkey"
            columns: ["sender_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "communications_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "communication_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          contact_group: string
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          practice: string | null
          tags: string[]
          updated_at: string
          version: number
        }
        Insert: {
          contact_group: string
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          practice?: string | null
          tags?: string[]
          updated_at?: string
          version?: number
        }
        Update: {
          contact_group?: string
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          practice?: string | null
          tags?: string[]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_logs: {
        Row: {
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          exercise_id: string
          id: string
          notes: string | null
          program_exercise_id: string | null
          rpe: number | null
          session_id: string
          sort_order: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          exercise_id: string
          id?: string
          notes?: string | null
          program_exercise_id?: string | null
          rpe?: number | null
          session_id: string
          sort_order?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          exercise_id?: string
          id?: string
          notes?: string | null
          program_exercise_id?: string | null
          rpe?: number | null
          session_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "exercise_logs_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_logs_program_exercise_id_fkey"
            columns: ["program_exercise_id"]
            isOneToOne: false
            referencedRelation: "program_exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_metric_units: {
        Row: {
          category: string
          code: string
          created_at: string
          deleted_at: string | null
          display_label: string
          id: string
          is_active: boolean
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          deleted_at?: string | null
          display_label: string
          id?: string
          is_active?: boolean
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          deleted_at?: string | null
          display_label?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_metric_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_tag_assignments: {
        Row: {
          created_at: string
          exercise_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_tag_assignments_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "exercise_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_tags: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          default_metric: string | null
          default_metric_value: string | null
          default_rep_metric: string | null
          default_reps: string | null
          default_rest_seconds: number | null
          default_sets: number | null
          deleted_at: string | null
          description: string | null
          id: string
          instructions: string | null
          movement_pattern_id: string | null
          name: string
          organization_id: string
          updated_at: string
          usage_count: number
          video_url: string | null
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          default_metric?: string | null
          default_metric_value?: string | null
          default_rep_metric?: string | null
          default_reps?: string | null
          default_rest_seconds?: number | null
          default_sets?: number | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          instructions?: string | null
          movement_pattern_id?: string | null
          name: string
          organization_id: string
          updated_at?: string
          usage_count?: number
          video_url?: string | null
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          default_metric?: string | null
          default_metric_value?: string | null
          default_rep_metric?: string | null
          default_reps?: string | null
          default_rest_seconds?: number | null
          default_sets?: number | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          instructions?: string | null
          movement_pattern_id?: string | null
          name?: string
          organization_id?: string
          updated_at?: string
          usage_count?: number
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercises_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "exercises_movement_pattern_id_fkey"
            columns: ["movement_pattern_id"]
            isOneToOne: false
            referencedRelation: "movement_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercises_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_tokens: {
        Row: {
          action_link: string
          client_id: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          organization_id: string
        }
        Insert: {
          action_link: string
          client_id: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          organization_id: string
        }
        Update: {
          action_link?: string
          client_id?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_threads: {
        Row: {
          client_id: string
          created_at: string
          deleted_at: string | null
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          last_message_sender_role: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          last_message_sender_role?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          last_message_sender_role?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_threads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          organization_id: string
          read_at: string | null
          sender_role: string
          sender_user_id: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          read_at?: string | null
          sender_role: string
          sender_user_id: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          read_at?: string | null
          sender_role?: string
          sender_user_id?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_user_id_fkey"
            columns: ["sender_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      movement_patterns: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "movement_patterns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      note_template_fields: {
        Row: {
          created_at: string
          default_value: string | null
          field_type: Database["public"]["Enums"]["note_template_field_type"]
          id: string
          label: string
          sort_order: number
          template_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_value?: string | null
          field_type?: Database["public"]["Enums"]["note_template_field_type"]
          id?: string
          label: string
          sort_order?: number
          template_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_value?: string | null
          field_type?: Database["public"]["Enums"]["note_template_field_type"]
          id?: string
          label?: string
          sort_order?: number
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_template_fields_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "note_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      note_templates: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          note_type: Database["public"]["Enums"]["note_type"]
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          note_type?: Database["public"]["Enums"]["note_type"]
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          note_type?: Database["public"]["Enums"]["note_type"]
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          abn: string | null
          address: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          email_notifications_enabled: boolean
          id: string
          name: string
          phone: string | null
          provider_number: string | null
          reminder_lead_hours: number
          slug: string
          sms_notifications_enabled: boolean
          timezone: string
          updated_at: string
        }
        Insert: {
          abn?: string | null
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          email_notifications_enabled?: boolean
          id?: string
          name: string
          phone?: string | null
          provider_number?: string | null
          reminder_lead_hours?: number
          slug: string
          sms_notifications_enabled?: boolean
          timezone?: string
          updated_at?: string
        }
        Update: {
          abn?: string | null
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          email_notifications_enabled?: boolean
          id?: string
          name?: string
          phone?: string | null
          provider_number?: string | null
          reminder_lead_hours?: number
          slug?: string
          sms_notifications_enabled?: boolean
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      password_recovery_tickets: {
        Row: {
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
        }
        Relationships: []
      }
      physical_markers_schema_seed: {
        Row: {
          category_display_order: number
          category_id: string
          category_name: string
          client_portal_visibility: Database["public"]["Enums"]["client_portal_visibility_t"]
          client_view_chart: Database["public"]["Enums"]["client_view_chart_t"]
          comparison_mode: Database["public"]["Enums"]["comparison_mode_t"]
          default_chart: Database["public"]["Enums"]["default_chart_t"]
          direction_of_good: Database["public"]["Enums"]["direction_of_good_t"]
          input_type: string
          metric_id: string
          metric_label: string
          side_left_right: boolean
          subcategory_display_order: number
          subcategory_id: string
          subcategory_name: string
          subcategory_notes: string | null
          test_display_order: number
          test_id: string
          test_name: string
          test_notes: string | null
          unit: string
        }
        Insert: {
          category_display_order: number
          category_id: string
          category_name: string
          client_portal_visibility: Database["public"]["Enums"]["client_portal_visibility_t"]
          client_view_chart: Database["public"]["Enums"]["client_view_chart_t"]
          comparison_mode: Database["public"]["Enums"]["comparison_mode_t"]
          default_chart: Database["public"]["Enums"]["default_chart_t"]
          direction_of_good: Database["public"]["Enums"]["direction_of_good_t"]
          input_type: string
          metric_id: string
          metric_label: string
          side_left_right: boolean
          subcategory_display_order: number
          subcategory_id: string
          subcategory_name: string
          subcategory_notes?: string | null
          test_display_order: number
          test_id: string
          test_name: string
          test_notes?: string | null
          unit: string
        }
        Update: {
          category_display_order?: number
          category_id?: string
          category_name?: string
          client_portal_visibility?: Database["public"]["Enums"]["client_portal_visibility_t"]
          client_view_chart?: Database["public"]["Enums"]["client_view_chart_t"]
          comparison_mode?: Database["public"]["Enums"]["comparison_mode_t"]
          default_chart?: Database["public"]["Enums"]["default_chart_t"]
          direction_of_good?: Database["public"]["Enums"]["direction_of_good_t"]
          input_type?: string
          metric_id?: string
          metric_label?: string
          side_left_right?: boolean
          subcategory_display_order?: number
          subcategory_id?: string
          subcategory_name?: string
          subcategory_notes?: string | null
          test_display_order?: number
          test_id?: string
          test_name?: string
          test_notes?: string | null
          unit?: string
        }
        Relationships: []
      }
      physical_markers_schema_version: {
        Row: {
          id: number
          schema_version: string
          seeded_at: string
        }
        Insert: {
          id?: number
          schema_version: string
          seeded_at?: string
        }
        Update: {
          id?: number
          schema_version?: string
          seeded_at?: string
        }
        Relationships: []
      }
      practice_custom_tests: {
        Row: {
          category_id: string
          created_at: string
          deleted_at: string | null
          display_order: number
          id: string
          metrics: Json
          name: string
          organization_id: string
          subcategory_id: string
          test_id: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          metrics: Json
          name: string
          organization_id: string
          subcategory_id: string
          test_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          metrics?: Json
          name?: string
          organization_id?: string
          subcategory_id?: string
          test_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_custom_tests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_disabled_tests: {
        Row: {
          disabled_at: string
          disabled_by: string | null
          id: string
          organization_id: string
          test_id: string
        }
        Insert: {
          disabled_at?: string
          disabled_by?: string | null
          id?: string
          organization_id: string
          test_id: string
        }
        Update: {
          disabled_at?: string
          disabled_by?: string | null
          id?: string
          organization_id?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_disabled_tests_disabled_by_fkey"
            columns: ["disabled_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "practice_disabled_tests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_test_settings: {
        Row: {
          client_view_chart:
            | Database["public"]["Enums"]["client_view_chart_t"]
            | null
          comparison_mode:
            | Database["public"]["Enums"]["comparison_mode_t"]
            | null
          created_at: string
          default_chart: Database["public"]["Enums"]["default_chart_t"] | null
          direction_of_good:
            | Database["public"]["Enums"]["direction_of_good_t"]
            | null
          id: string
          metric_id: string
          organization_id: string
          test_id: string
          updated_at: string
        }
        Insert: {
          client_view_chart?:
            | Database["public"]["Enums"]["client_view_chart_t"]
            | null
          comparison_mode?:
            | Database["public"]["Enums"]["comparison_mode_t"]
            | null
          created_at?: string
          default_chart?: Database["public"]["Enums"]["default_chart_t"] | null
          direction_of_good?:
            | Database["public"]["Enums"]["direction_of_good_t"]
            | null
          id?: string
          metric_id: string
          organization_id: string
          test_id: string
          updated_at?: string
        }
        Update: {
          client_view_chart?:
            | Database["public"]["Enums"]["client_view_chart_t"]
            | null
          comparison_mode?:
            | Database["public"]["Enums"]["comparison_mode_t"]
            | null
          created_at?: string
          default_chart?: Database["public"]["Enums"]["default_chart_t"] | null
          direction_of_good?:
            | Database["public"]["Enums"]["direction_of_good_t"]
            | null
          id?: string
          metric_id?: string
          organization_id?: string
          test_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_test_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      program_days: {
        Row: {
          created_at: string
          day_label: string
          deleted_at: string | null
          id: string
          program_id: string
          program_week_id: string | null
          published_at: string | null
          scheduled_date: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_label: string
          deleted_at?: string | null
          id?: string
          program_id: string
          program_week_id?: string | null
          published_at?: string | null
          scheduled_date: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_label?: string
          deleted_at?: string | null
          id?: string
          program_id?: string
          program_week_id?: string | null
          published_at?: string | null
          scheduled_date?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_days_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_days_program_week_id_fkey"
            columns: ["program_week_id"]
            isOneToOne: false
            referencedRelation: "program_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      program_exercise_sets: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          optional_metric: string | null
          optional_value: string | null
          program_exercise_id: string
          rep_metric: string | null
          reps: string | null
          set_number: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          optional_metric?: string | null
          optional_value?: string | null
          program_exercise_id: string
          rep_metric?: string | null
          reps?: string | null
          set_number: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          optional_metric?: string | null
          optional_value?: string | null
          program_exercise_id?: string
          rep_metric?: string | null
          reps?: string | null
          set_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_exercise_sets_program_exercise_id_fkey"
            columns: ["program_exercise_id"]
            isOneToOne: false
            referencedRelation: "program_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      program_exercises: {
        Row: {
          created_at: string
          deleted_at: string | null
          exercise_id: string
          id: string
          instructions: string | null
          optional_metric: string | null
          optional_value: string | null
          program_day_id: string
          reps: string | null
          rest_seconds: number | null
          rpe: number | null
          section_title: string | null
          sets: number | null
          sort_order: number
          superset_group_id: string | null
          tempo: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          exercise_id: string
          id?: string
          instructions?: string | null
          optional_metric?: string | null
          optional_value?: string | null
          program_day_id: string
          reps?: string | null
          rest_seconds?: number | null
          rpe?: number | null
          section_title?: string | null
          sets?: number | null
          sort_order?: number
          superset_group_id?: string | null
          tempo?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          exercise_id?: string
          id?: string
          instructions?: string | null
          optional_metric?: string | null
          optional_value?: string | null
          program_day_id?: string
          reps?: string | null
          rest_seconds?: number | null
          rpe?: number | null
          section_title?: string | null
          sets?: number | null
          sort_order?: number
          superset_group_id?: string | null
          tempo?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "program_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_exercises_program_day_id_fkey"
            columns: ["program_day_id"]
            isOneToOne: false
            referencedRelation: "program_days"
            referencedColumns: ["id"]
          },
        ]
      }
      program_templates: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_templates_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "program_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      program_weeks: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          notes: string | null
          program_id: string
          updated_at: string
          week_number: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          program_id: string
          updated_at?: string
          week_number: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          program_id?: string
          updated_at?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "program_weeks_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          archived_at: string | null
          client_id: string
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          duration_weeks: number | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          start_date: string | null
          status: Database["public"]["Enums"]["program_status"]
          template_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          client_id: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          duration_weeks?: number | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["program_status"]
          template_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          client_id?: string
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          duration_weeks?: number | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["program_status"]
          template_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "programs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "programs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "program_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_log: {
        Row: {
          created_at: string
          id: string
          key: string
          outcome: Database["public"]["Enums"]["rate_outcome"]
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          outcome?: Database["public"]["Enums"]["rate_outcome"]
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          outcome?: Database["public"]["Enums"]["rate_outcome"]
        }
        Relationships: []
      }
      report_versions: {
        Row: {
          format_notes: string | null
          generated_at: string
          generated_by_user_id: string | null
          id: string
          report_id: string
          storage_bucket: string
          storage_path: string
          version_number: number
        }
        Insert: {
          format_notes?: string | null
          generated_at?: string
          generated_by_user_id?: string | null
          id?: string
          report_id: string
          storage_bucket: string
          storage_path: string
          version_number: number
        }
        Update: {
          format_notes?: string | null
          generated_at?: string
          generated_by_user_id?: string | null
          id?: string
          report_id?: string
          storage_bucket?: string
          storage_path?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_versions_generated_by_user_id_fkey"
            columns: ["generated_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "report_versions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          client_id: string
          created_at: string
          current_version: number
          deleted_at: string | null
          generated_by_user_id: string | null
          id: string
          is_published: boolean
          organization_id: string
          published_at: string | null
          report_type: string
          storage_bucket: string
          storage_path: string
          test_date: string
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          generated_by_user_id?: string | null
          id?: string
          is_published?: boolean
          organization_id: string
          published_at?: string | null
          report_type: string
          storage_bucket?: string
          storage_path: string
          test_date: string
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          generated_by_user_id?: string | null
          id?: string
          is_published?: boolean
          organization_id?: string
          published_at?: string | null
          report_type?: string
          storage_bucket?: string
          storage_path?: string
          test_date?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_generated_by_user_id_fkey"
            columns: ["generated_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      section_titles: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "section_titles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      session_template_exercise_sets: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          optional_metric: string | null
          optional_value: string | null
          rep_metric: string | null
          reps: string | null
          session_template_exercise_id: string
          set_number: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          optional_metric?: string | null
          optional_value?: string | null
          rep_metric?: string | null
          reps?: string | null
          session_template_exercise_id: string
          set_number: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          optional_metric?: string | null
          optional_value?: string | null
          rep_metric?: string | null
          reps?: string | null
          session_template_exercise_id?: string
          set_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_template_exercise_set_session_template_exercise_id_fkey"
            columns: ["session_template_exercise_id"]
            isOneToOne: false
            referencedRelation: "session_template_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      session_template_exercises: {
        Row: {
          created_at: string
          deleted_at: string | null
          exercise_id: string
          id: string
          instructions: string | null
          optional_metric: string | null
          optional_value: string | null
          reps: string | null
          rest_seconds: number | null
          rpe: number | null
          section_title: string | null
          session_template_id: string
          sets: number | null
          sort_order: number
          superset_group_id: string | null
          tempo: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          exercise_id: string
          id?: string
          instructions?: string | null
          optional_metric?: string | null
          optional_value?: string | null
          reps?: string | null
          rest_seconds?: number | null
          rpe?: number | null
          section_title?: string | null
          session_template_id: string
          sets?: number | null
          sort_order?: number
          superset_group_id?: string | null
          tempo?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          exercise_id?: string
          id?: string
          instructions?: string | null
          optional_metric?: string | null
          optional_value?: string | null
          reps?: string | null
          rest_seconds?: number | null
          rpe?: number | null
          section_title?: string | null
          session_template_id?: string
          sets?: number | null
          sort_order?: number
          superset_group_id?: string | null
          tempo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_template_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_template_exercises_session_template_id_fkey"
            columns: ["session_template_id"]
            isOneToOne: false
            referencedRelation: "session_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      session_templates: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_templates_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "session_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      session_types: {
        Row: {
          color: string
          created_at: string
          default_duration_minutes: number
          deleted_at: string | null
          id: string
          kind: string
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color: string
          created_at?: string
          default_duration_minutes?: number
          deleted_at?: string | null
          id?: string
          kind?: string
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          default_duration_minutes?: number
          deleted_at?: string | null
          id?: string
          kind?: string
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          appointment_id: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          duration_minutes: number | null
          feedback: string | null
          id: string
          organization_id: string
          program_day_id: string | null
          session_rpe: number | null
          started_at: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_minutes?: number | null
          feedback?: string | null
          id?: string
          organization_id: string
          program_day_id?: string | null
          session_rpe?: number | null
          started_at?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_minutes?: number | null
          feedback?: string | null
          id?: string
          organization_id?: string
          program_day_id?: string | null
          session_rpe?: number | null
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_appointment_fk"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_program_day_id_fkey"
            columns: ["program_day_id"]
            isOneToOne: false
            referencedRelation: "program_days"
            referencedColumns: ["id"]
          },
        ]
      }
      set_logs: {
        Row: {
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          exercise_log_id: string
          id: string
          notes: string | null
          optional_metric: string | null
          optional_value: string | null
          rep_metric: string | null
          reps_performed: number | null
          rpe: number | null
          set_number: number
          weight_metric: string | null
          weight_value: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          exercise_log_id: string
          id?: string
          notes?: string | null
          optional_metric?: string | null
          optional_value?: string | null
          rep_metric?: string | null
          reps_performed?: number | null
          rpe?: number | null
          set_number: number
          weight_metric?: string | null
          weight_value?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          exercise_log_id?: string
          id?: string
          notes?: string | null
          optional_metric?: string | null
          optional_value?: string | null
          rep_metric?: string | null
          reps_performed?: number | null
          rpe?: number | null
          set_number?: number
          weight_metric?: string | null
          weight_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "set_logs_exercise_log_id_fkey"
            columns: ["exercise_log_id"]
            isOneToOne: false
            referencedRelation: "exercise_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      template_days: {
        Row: {
          created_at: string
          day_label: string
          deleted_at: string | null
          id: string
          sort_order: number
          template_week_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_label: string
          deleted_at?: string | null
          id?: string
          sort_order?: number
          template_week_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_label?: string
          deleted_at?: string | null
          id?: string
          sort_order?: number
          template_week_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_days_template_week_id_fkey"
            columns: ["template_week_id"]
            isOneToOne: false
            referencedRelation: "template_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      template_exercise_sets: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          optional_metric: string | null
          optional_value: string | null
          rep_metric: string | null
          reps: string | null
          set_number: number
          template_exercise_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          optional_metric?: string | null
          optional_value?: string | null
          rep_metric?: string | null
          reps?: string | null
          set_number: number
          template_exercise_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          optional_metric?: string | null
          optional_value?: string | null
          rep_metric?: string | null
          reps?: string | null
          set_number?: number
          template_exercise_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_exercise_sets_template_exercise_id_fkey"
            columns: ["template_exercise_id"]
            isOneToOne: false
            referencedRelation: "template_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      template_exercises: {
        Row: {
          created_at: string
          deleted_at: string | null
          exercise_id: string
          id: string
          instructions: string | null
          optional_metric: string | null
          optional_value: string | null
          reps: string | null
          rest_seconds: number | null
          rpe: number | null
          section_title: string | null
          sets: number | null
          sort_order: number
          superset_group_id: string | null
          template_day_id: string
          tempo: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          exercise_id: string
          id?: string
          instructions?: string | null
          optional_metric?: string | null
          optional_value?: string | null
          reps?: string | null
          rest_seconds?: number | null
          rpe?: number | null
          section_title?: string | null
          sets?: number | null
          sort_order?: number
          superset_group_id?: string | null
          template_day_id: string
          tempo?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          exercise_id?: string
          id?: string
          instructions?: string | null
          optional_metric?: string | null
          optional_value?: string | null
          reps?: string | null
          rest_seconds?: number | null
          rpe?: number | null
          section_title?: string | null
          sets?: number | null
          sort_order?: number
          superset_group_id?: string | null
          template_day_id?: string
          tempo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_exercises_template_day_id_fkey"
            columns: ["template_day_id"]
            isOneToOne: false
            referencedRelation: "template_days"
            referencedColumns: ["id"]
          },
        ]
      }
      template_weeks: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          notes: string | null
          template_id: string
          updated_at: string
          week_number: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          template_id: string
          updated_at?: string
          week_number: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          template_id?: string
          updated_at?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "template_weeks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "program_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      test_batteries: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          metric_keys: Json
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          metric_keys: Json
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          metric_keys?: Json
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_batteries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      test_results: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          metric_id: string
          organization_id: string
          side: Database["public"]["Enums"]["test_side_t"] | null
          test_id: string
          test_session_id: string
          unit: string
          value: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          metric_id: string
          organization_id: string
          side?: Database["public"]["Enums"]["test_side_t"] | null
          test_id: string
          test_session_id: string
          unit: string
          value: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          metric_id?: string
          organization_id?: string
          side?: Database["public"]["Enums"]["test_side_t"] | null
          test_id?: string
          test_session_id?: string
          unit?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "test_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_results_test_session_id_fkey"
            columns: ["test_session_id"]
            isOneToOne: false
            referencedRelation: "test_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      test_sessions: {
        Row: {
          applied_battery_id: string | null
          appointment_id: string | null
          client_id: string
          conducted_at: string
          conducted_by: string
          created_at: string
          deleted_at: string | null
          id: string
          notes: string | null
          organization_id: string
          source: Database["public"]["Enums"]["test_source_t"]
          updated_at: string
          version: number
        }
        Insert: {
          applied_battery_id?: string | null
          appointment_id?: string | null
          client_id: string
          conducted_at: string
          conducted_by: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          source?: Database["public"]["Enums"]["test_source_t"]
          updated_at?: string
          version?: number
        }
        Update: {
          applied_battery_id?: string | null
          appointment_id?: string | null
          client_id?: string
          conducted_at?: string
          conducted_by?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          source?: Database["public"]["Enums"]["test_source_t"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "test_sessions_applied_battery_id_fkey"
            columns: ["applied_battery_id"]
            isOneToOne: false
            referencedRelation: "test_batteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_sessions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_sessions_conducted_by_fkey"
            columns: ["conducted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "test_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_organization_roles: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_organization_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          deleted_at: string | null
          first_name: string
          last_name: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          first_name: string
          last_name: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          first_name?: string
          last_name?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vald_device_types: {
        Row: {
          code: string
          created_at: string
          deleted_at: string | null
          display_label: string
          id: string
          is_active: boolean
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          deleted_at?: string | null
          display_label: string
          id?: string
          is_active?: boolean
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          deleted_at?: string | null
          display_label?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vald_device_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vald_raw_uploads: {
        Row: {
          associated_report_id: string | null
          deleted_at: string | null
          device_type_id: string
          file_size_bytes: number | null
          id: string
          organization_id: string
          parse_error: string | null
          parsed_at: string | null
          payload: Json | null
          source_filename: string
          storage_bucket: string
          storage_path: string
          uploaded_at: string
          uploaded_by_user_id: string
        }
        Insert: {
          associated_report_id?: string | null
          deleted_at?: string | null
          device_type_id: string
          file_size_bytes?: number | null
          id?: string
          organization_id: string
          parse_error?: string | null
          parsed_at?: string | null
          payload?: Json | null
          source_filename: string
          storage_bucket?: string
          storage_path: string
          uploaded_at?: string
          uploaded_by_user_id: string
        }
        Update: {
          associated_report_id?: string | null
          deleted_at?: string | null
          device_type_id?: string
          file_size_bytes?: number | null
          id?: string
          organization_id?: string
          parse_error?: string | null
          parsed_at?: string | null
          payload?: Json | null
          source_filename?: string
          storage_bucket?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vald_raw_uploads_associated_report_id_fkey"
            columns: ["associated_report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vald_raw_uploads_device_type_id_fkey"
            columns: ["device_type_id"]
            isOneToOne: false
            referencedRelation: "vald_device_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vald_raw_uploads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vald_raw_uploads_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      test_results_with_baseline: {
        Row: {
          client_id: string | null
          conducted_at: string | null
          created_at: string | null
          id: string | null
          is_baseline: boolean | null
          metric_id: string | null
          organization_id: string | null
          side: Database["public"]["Enums"]["test_side_t"] | null
          test_id: string | null
          test_session_id: string | null
          unit: string | null
          value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "test_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_results_test_session_id_fkey"
            columns: ["test_session_id"]
            isOneToOne: false
            referencedRelation: "test_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _clone_program: {
        Args: {
          p_new_name: string
          p_new_start_date: string
          p_source_program_id: string
        }
        Returns: Json
      }
      _program_for_date: {
        Args: { p_client_id: string; p_date: string }
        Returns: string
      }
      _test_clear_jwt: { Args: never; Returns: undefined }
      _test_grant_membership: {
        Args: {
          p_org_id: string
          p_role: Database["public"]["Enums"]["user_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      _test_insert_client_publication: {
        Args: {
          p_framing_text?: string
          p_org: string
          p_published_by: string
          p_session: string
          p_test_id: string
        }
        Returns: string
      }
      _test_insert_test_result: {
        Args: {
          p_metric_id: string
          p_org: string
          p_session: string
          p_side: Database["public"]["Enums"]["test_side_t"]
          p_test_id: string
          p_unit: string
          p_value: number
        }
        Returns: undefined
      }
      _test_insert_test_session: {
        Args: {
          p_client: string
          p_conducted_at: string
          p_conducted_by: string
          p_id: string
          p_org: string
          p_source?: Database["public"]["Enums"]["test_source_t"]
        }
        Returns: string
      }
      _test_make_user: { Args: { p_email: string }; Returns: string }
      _test_set_jwt: {
        Args: { p_organization_id: string; p_role: string; p_user_id: string }
        Returns: undefined
      }
      apply_session_to_program_day: {
        Args: { p_program_day_id: string; p_session_id: string }
        Returns: Json
      }
      assert_audit_resolver_coverage: { Args: never; Returns: undefined }
      audit_diff_fields: {
        Args: { p_new: Json; p_old: Json }
        Returns: string[]
      }
      audit_resolve_org_id: {
        Args: { p_row: Json; p_table: string }
        Returns: string
      }
      audit_trim_row: { Args: { p_row: Json; p_table: string }; Returns: Json }
      battery_in_clients_published_session: {
        Args: { p_battery_id: string }
        Returns: boolean
      }
      calendar_feed_events: {
        Args: { p_token: string }
        Returns: {
          appointment_type: string
          end_at: string
          kind: string
          location: string
          start_at: string
        }[]
      }
      client_accept_invite: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      client_available_slots: {
        Args: { p_from: string; p_slot_minutes: number; p_to: string }
        Returns: {
          slot_end: string
          slot_start: string
          staff_user_id: string
        }[]
      }
      client_book_appointment: {
        Args: {
          p_end_at: string
          p_session_type_id: string
          p_staff_user_id: string
          p_start_at: string
        }
        Returns: string
      }
      client_cancel_appointment: {
        Args: { p_appointment_id: string }
        Returns: undefined
      }
      client_complete_session: {
        Args: {
          p_feedback: string
          p_session_id: string
          p_session_rpe: number
        }
        Returns: undefined
      }
      client_get_program_day_exercises: {
        Args: { p_program_day_id: string }
        Returns: {
          exercise_id: string
          exercise_name: string
          exercise_video_url: string
          instructions: string
          prescription_sets: Json
          program_exercise_id: string
          rest_seconds: number
          section_title: string
          sort_order: number
          superset_group_id: string
          tempo: string
        }[]
      }
      client_get_published_reports: {
        Args: never
        Returns: {
          current_version: number
          published_at: string
          report_id: string
          report_type: string
          storage_bucket: string
          storage_path: string
          test_date: string
          title: string
        }[]
      }
      client_get_week_overview: {
        Args: { p_week_start_date: string }
        Returns: {
          day_label: string
          exercises: Json
          program_day_id: string
          scheduled_date: string
          sort_order: number
        }[]
      }
      client_list_program_days: {
        Args: { p_program_id: string }
        Returns: {
          day_label: string
          day_of_week: number
          exercise_count: number
          program_day_id: string
          sort_order: number
          week_number: number
        }[]
      }
      client_log_exercise_note: {
        Args: {
          p_notes: string
          p_program_exercise_id: string
          p_session_id: string
        }
        Returns: string
      }
      client_log_set: {
        Args: {
          p_notes: string
          p_optional_metric: string
          p_optional_value: string
          p_program_exercise_id: string
          p_rep_metric?: string
          p_reps_performed: number
          p_rpe: number
          p_session_id: string
          p_set_number: number
          p_weight_metric: string
          p_weight_value: number
        }
        Returns: string
      }
      client_owns_test_session: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      client_reschedule_program_day_to_today: {
        Args: { p_program_day_id: string; p_today: string }
        Returns: string
      }
      client_start_session: {
        Args: { p_program_day_id: string }
        Returns: string
      }
      consume_recovery_ticket: {
        Args: { p_ticket_id: string }
        Returns: string
      }
      copy_program: {
        Args: {
          p_new_name?: string
          p_new_start_date: string
          p_source_program_id: string
        }
        Returns: Json
      }
      copy_program_day: {
        Args: {
          p_force?: boolean
          p_source_day_id: string
          p_target_date: string
        }
        Returns: Json
      }
      copy_program_week: {
        Args: {
          p_client_id: string
          p_force?: boolean
          p_source_week_start: string
          p_target_week_start: string
        }
        Returns: Json
      }
      create_organization_with_owner: {
        Args: {
          p_first_name: string
          p_last_name: string
          p_org_name: string
          p_timezone: string
        }
        Returns: string
      }
      create_program_day: {
        Args: { p_client_id: string; p_target_date: string }
        Returns: Json
      }
      create_program_from_template: {
        Args: {
          p_client_id: string
          p_name?: string
          p_start_date: string
          p_template_id: string
        }
        Returns: Json
      }
      create_test_session: {
        Args: {
          p_applied_battery_id: string
          p_appointment_id: string
          p_client_id: string
          p_conducted_at: string
          p_notes: string
          p_results: Json
          p_source: Database["public"]["Enums"]["test_source_t"]
        }
        Returns: string
      }
      duplicate_program_day: {
        Args: { p_source_day_id: string; p_target_date: string }
        Returns: Json
      }
      duplicate_template_day: {
        Args: { p_source_day_id: string }
        Returns: Json
      }
      insert_circuit_into_day: {
        Args: { p_circuit_id: string; p_program_day_id: string }
        Returns: Json
      }
      insert_program_exercise_at: {
        Args: {
          p_after_pe_id?: string
          p_day_id: string
          p_exercise_id: string
          p_slot?: string
        }
        Returns: string
      }
      insert_session_exercise_at: {
        Args: {
          p_after_id?: string
          p_exercise_id: string
          p_session_id: string
          p_slot?: string
        }
        Returns: string
      }
      insert_template_exercise_at: {
        Args: {
          p_after_id?: string
          p_day_id: string
          p_exercise_id: string
          p_slot?: string
        }
        Returns: string
      }
      rate_limit_check_and_record: {
        Args: { p_key: string; p_max: number; p_window: string }
        Returns: Record<string, unknown>
      }
      rate_limit_check_failures: {
        Args: { p_key: string; p_max: number; p_window: string }
        Returns: Record<string, unknown>
      }
      rate_limit_record_failure: { Args: { p_key: string }; Returns: undefined }
      regenerate_calendar_feed_token: { Args: never; Returns: string }
      reorder_program_exercises: {
        Args: {
          p_day_id: string
          p_moved_pe_id: string
          p_ordered_ids: string[]
        }
        Returns: undefined
      }
      reorder_session_exercises: {
        Args: {
          p_moved_id: string
          p_ordered_ids: string[]
          p_session_id: string
        }
        Returns: undefined
      }
      reorder_template_exercises: {
        Args: { p_day_id: string; p_moved_id: string; p_ordered_ids: string[] }
        Returns: undefined
      }
      repeat_program: { Args: { p_source_program_id: string }; Returns: Json }
      repeat_program_day_weekly: {
        Args: { p_end_date: string; p_force?: boolean; p_source_day_id: string }
        Returns: Json
      }
      repeat_program_week: {
        Args: {
          p_client_id: string
          p_end_date: string
          p_force?: boolean
          p_source_week_start: string
        }
        Returns: Json
      }
      restore_client: { Args: { p_id: string }; Returns: undefined }
      restore_client_medical_history: {
        Args: { p_id: string }
        Returns: undefined
      }
      restore_client_publication: { Args: { p_id: string }; Returns: undefined }
      restore_clinical_note: { Args: { p_id: string }; Returns: undefined }
      restore_practice_custom_test: {
        Args: { p_id: string }
        Returns: undefined
      }
      restore_program_exercise: { Args: { p_id: string }; Returns: undefined }
      restore_test_battery: { Args: { p_id: string }; Returns: undefined }
      restore_test_result: { Args: { p_id: string }; Returns: undefined }
      restore_test_session: { Args: { p_id: string }; Returns: undefined }
      revoke_calendar_feed_token: { Args: never; Returns: undefined }
      save_day_as_session: {
        Args: { p_name: string; p_program_day_id: string }
        Returns: Json
      }
      save_group_as_circuit: {
        Args: {
          p_circuit_type: string
          p_name: string
          p_notes?: string
          p_program_exercise_ids: string[]
        }
        Returns: Json
      }
      save_program_as_template: {
        Args: { p_name?: string; p_program_id: string }
        Returns: Json
      }
      seed_organization_defaults: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soft_delete_availability_rule: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_circuit: { Args: { p_id: string }; Returns: undefined }
      soft_delete_circuit_exercise: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_circuit_exercise_set: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_client: { Args: { p_id: string }; Returns: undefined }
      soft_delete_client_medical_history: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_client_publication: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_clinical_note: { Args: { p_id: string }; Returns: undefined }
      soft_delete_exercise: { Args: { p_id: string }; Returns: undefined }
      soft_delete_exercise_tag: { Args: { p_id: string }; Returns: undefined }
      soft_delete_movement_pattern: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_practice_custom_test: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_program_day: { Args: { p_id: string }; Returns: undefined }
      soft_delete_program_exercise: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_program_exercise_set: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_program_template: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_session_template: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_session_template_exercise: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_session_template_exercise_set: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_template_day: { Args: { p_id: string }; Returns: undefined }
      soft_delete_template_exercise: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_template_exercise_set: {
        Args: { p_id: string }
        Returns: undefined
      }
      soft_delete_test_battery: { Args: { p_id: string }; Returns: undefined }
      soft_delete_test_result: { Args: { p_id: string }; Returns: undefined }
      soft_delete_test_session: { Args: { p_id: string }; Returns: undefined }
      soft_delete_unavailable_block: {
        Args: { p_id: string }
        Returns: undefined
      }
      staff_create_client_invite: {
        Args: {
          p_category_id?: string
          p_dob?: string
          p_email: string
          p_first_name: string
          p_last_name: string
          p_phone?: string
          p_referral_source?: string
        }
        Returns: string
      }
      staff_next_available_slot: {
        Args: {
          p_from: string
          p_slot_minutes: number
          p_staff_user_id: string
        }
        Returns: {
          slot_end: string
          slot_start: string
        }[]
      }
      swap_program_exercise: {
        Args: { p_new_exercise_id: string; p_pe_id: string }
        Returns: string
      }
      sync_client_profile_name: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      test_metric_visibility: {
        Args: {
          p_metric_id: string
          p_organization_id: string
          p_test_id: string
        }
        Returns: Database["public"]["Enums"]["client_portal_visibility_t"]
      }
      test_session_has_active_publication: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      test_session_has_auto_visible_metric: {
        Args: { p_org_id: string; p_session_id: string }
        Returns: boolean
      }
      test_session_in_org: {
        Args: { p_org_id: string; p_session_id: string }
        Returns: boolean
      }
      test_session_is_baseline: {
        Args: { p_session_id: string; p_test_id: string }
        Returns: boolean
      }
      user_organization_id: { Args: never; Returns: string }
      user_role: { Args: never; Returns: string }
    }
    Enums: {
      appointment_reminder_status:
        | "scheduled"
        | "sent"
        | "delivered"
        | "failed"
        | "bounced"
        | "cancelled"
      appointment_reminder_type:
        | "confirmation_email"
        | "confirmation_sms"
        | "reminder_24h_email"
        | "reminder_24h_sms"
      appointment_status:
        | "pending"
        | "confirmed"
        | "cancelled"
        | "completed"
        | "no_show"
      assessment_status: "draft" | "completed" | "archived"
      audit_action: "INSERT" | "UPDATE" | "DELETE"
      availability_recurrence: "weekly" | "one_off"
      client_portal_visibility_t: "auto" | "on_publish" | "never"
      client_view_chart_t:
        | "line"
        | "milestone"
        | "bar"
        | "narrative_only"
        | "hidden"
      communication_direction: "outbound" | "inbound"
      communication_status:
        | "draft"
        | "queued"
        | "sent"
        | "delivered"
        | "failed"
        | "bounced"
      communication_type: "email" | "sms"
      comparison_mode_t:
        | "absolute"
        | "bilateral_lsi"
        | "vs_baseline"
        | "vs_normative"
      default_chart_t:
        | "line"
        | "bar"
        | "radar"
        | "asymmetry_bar"
        | "target_zone"
      direction_of_good_t:
        | "higher"
        | "lower"
        | "target_range"
        | "context_dependent"
      file_category:
        | "gpccmp"
        | "radiology"
        | "workers_comp"
        | "specialist_letter"
        | "referral"
        | "other"
      note_template_field_type: "short_text" | "long_text" | "number"
      note_type:
        | "initial_assessment"
        | "progress_note"
        | "injury_flag"
        | "contraindication"
        | "discharge"
        | "general"
      program_status: "draft" | "active" | "archived"
      rate_outcome: "attempt" | "failure"
      test_side_t: "left" | "right"
      test_source_t: "manual" | "vald" | "imported"
      user_role: "owner" | "staff" | "client"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      appointment_reminder_status: [
        "scheduled",
        "sent",
        "delivered",
        "failed",
        "bounced",
        "cancelled",
      ],
      appointment_reminder_type: [
        "confirmation_email",
        "confirmation_sms",
        "reminder_24h_email",
        "reminder_24h_sms",
      ],
      appointment_status: [
        "pending",
        "confirmed",
        "cancelled",
        "completed",
        "no_show",
      ],
      assessment_status: ["draft", "completed", "archived"],
      audit_action: ["INSERT", "UPDATE", "DELETE"],
      availability_recurrence: ["weekly", "one_off"],
      client_portal_visibility_t: ["auto", "on_publish", "never"],
      client_view_chart_t: [
        "line",
        "milestone",
        "bar",
        "narrative_only",
        "hidden",
      ],
      communication_direction: ["outbound", "inbound"],
      communication_status: [
        "draft",
        "queued",
        "sent",
        "delivered",
        "failed",
        "bounced",
      ],
      communication_type: ["email", "sms"],
      comparison_mode_t: [
        "absolute",
        "bilateral_lsi",
        "vs_baseline",
        "vs_normative",
      ],
      default_chart_t: ["line", "bar", "radar", "asymmetry_bar", "target_zone"],
      direction_of_good_t: [
        "higher",
        "lower",
        "target_range",
        "context_dependent",
      ],
      file_category: [
        "gpccmp",
        "radiology",
        "workers_comp",
        "specialist_letter",
        "referral",
        "other",
      ],
      note_template_field_type: ["short_text", "long_text", "number"],
      note_type: [
        "initial_assessment",
        "progress_note",
        "injury_flag",
        "contraindication",
        "discharge",
        "general",
      ],
      program_status: ["draft", "active", "archived"],
      rate_outcome: ["attempt", "failure"],
      test_side_t: ["left", "right"],
      test_source_t: ["manual", "vald", "imported"],
      user_role: ["owner", "staff", "client"],
    },
  },
} as const
