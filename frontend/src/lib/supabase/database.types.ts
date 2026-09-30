export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      catalogue_shares: {
        Row: {
          created_at: string
          destination: string
          id: string
          product_id: string | null
          share_type: string
          store_id: string
        }
        Insert: {
          created_at?: string
          destination: string
          id?: string
          product_id?: string | null
          share_type: string
          store_id: string
        }
        Update: {
          created_at?: string
          destination?: string
          id?: string
          product_id?: string | null
          share_type?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogue_shares_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogue_shares_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          id: string
          name: string
          store_id: string
        }
        Insert: {
          id?: string
          name: string
          store_id: string
        }
        Update: {
          id?: string
          name?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          id: string
          last_active_at: string | null
          name: string
          phone: string
          status: string
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_active_at?: string | null
          name: string
          phone: string
          status?: string
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_active_at?: string | null
          name?: string
          phone?: string
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          app_version: string | null
          customer_id: string | null
          event_name: string
          id: string
          occurred_at: string
          offer_id: string | null
          order_id: string | null
          product_id: string | null
          props: Json | null
          store_id: string | null
          user_id: string | null
          visitor_id: string | null
        }
        Insert: {
          app_version?: string | null
          customer_id?: string | null
          event_name: string
          id?: string
          occurred_at?: string
          offer_id?: string | null
          order_id?: string | null
          product_id?: string | null
          props?: Json | null
          store_id?: string | null
          user_id?: string | null
          visitor_id?: string | null
        }
        Update: {
          app_version?: string | null
          customer_id?: string | null
          event_name?: string
          id?: string
          occurred_at?: string
          offer_id?: string | null
          order_id?: string | null
          product_id?: string | null
          props?: Json | null
          store_id?: string | null
          user_id?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      offers: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          offer_date: string
          offer_price: number | null
          product_id: string
          regular_price: number | null
          regular_price_label: string | null
          saving: number | null
          starts_at: string | null
          store_id: string
          today_price_label: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          offer_date?: string
          offer_price?: number | null
          product_id: string
          regular_price?: number | null
          regular_price_label?: string | null
          saving?: number | null
          starts_at?: string | null
          store_id: string
          today_price_label: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          offer_date?: string
          offer_price?: number | null
          product_id?: string
          regular_price?: number | null
          regular_price_label?: string | null
          saving?: number | null
          starts_at?: string | null
          store_id?: string
          today_price_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          price: string | null
          product_id: string | null
          product_name: string
          qty: number
        }
        Insert: {
          id?: string
          order_id: string
          price?: string | null
          product_id?: string | null
          product_name: string
          qty: number
        }
        Update: {
          id?: string
          order_id?: string
          price?: string | null
          product_id?: string | null
          product_name?: string
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          confirmed_at: string | null
          created_at: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          id: string
          is_new: boolean
          note: string | null
          rejection_note: string | null
          rejection_reason: string | null
          status: string
          store_id: string
          total: number | null
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name: string
          customer_phone: string
          id?: string
          is_new?: boolean
          note?: string | null
          rejection_note?: string | null
          rejection_reason?: string | null
          status?: string
          store_id: string
          total?: number | null
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          id?: string
          is_new?: boolean
          note?: string | null
          rejection_note?: string | null
          rejection_reason?: string | null
          status?: string
          store_id?: string
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_history: {
        Row: {
          available: boolean
          category_id: string | null
          id: string
          name: string
          price: number | null
          product_id: string
          recorded_at: string
          store_id: string
        }
        Insert: {
          available: boolean
          category_id?: string | null
          id?: string
          name: string
          price?: number | null
          product_id: string
          recorded_at?: string
          store_id: string
        }
        Update: {
          available?: boolean
          category_id?: string | null
          id?: string
          name?: string
          price?: number | null
          product_id?: string
          recorded_at?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          available: boolean
          category_id: string | null
          created_at: string
          id: string
          image_url: string | null
          name: string
          price: number | null
          store_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          available?: boolean
          category_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          name: string
          price?: number | null
          store_id: string
          unit?: string
          updated_at?: string
        }
        Update: {
          available?: boolean
          category_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          name?: string
          price?: number | null
          store_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          business_types: string[]
          created_at: string
          id: string
          is_open: boolean
          last_active_at: string | null
          location: string | null
          owner_id: string
          phone: string
          shop_name: string
          slug: string
          status: string
          vendor_name: string
        }
        Insert: {
          business_types?: string[]
          created_at?: string
          id?: string
          is_open?: boolean
          last_active_at?: string | null
          location?: string | null
          owner_id: string
          phone: string
          shop_name: string
          slug: string
          status?: string
          vendor_name: string
        }
        Update: {
          business_types?: string[]
          created_at?: string
          id?: string
          is_open?: boolean
          last_active_at?: string | null
          location?: string | null
          owner_id?: string
          phone?: string
          shop_name?: string
          slug?: string
          status?: string
          vendor_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_stores: {
        Row: {
          id: string | null
          is_open: boolean | null
          shop_name: string | null
          slug: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_login_lock: { Args: { p_phone: string }; Returns: boolean }
      clear_login_attempts: { Args: never; Returns: undefined }
      log_event: {
        Args: {
          p_app_version?: string
          p_event_name: string
          p_offer_id?: string
          p_order_id?: string
          p_product_id?: string
          p_props?: Json
          p_slug?: string
          p_visitor_id?: string
        }
        Returns: undefined
      }
      place_order: {
        Args: {
          p_items: Json
          p_name: string
          p_note: string
          p_phone: string
          p_slug: string
        }
        Returns: string
      }
      record_login_failure: { Args: { p_phone: string }; Returns: boolean }
      today_ist: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

