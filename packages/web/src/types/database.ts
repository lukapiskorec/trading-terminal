/** Supabase database type definitions — keeps the client typed without codegen */

export interface Database {
  public: {
    Tables: {
      markets: {
        Row: {
          id: number;
          slug: string;
          condition_id: string;
          token_id_yes: string;
          token_id_no: string;
          question: string | null;
          start_time: string;
          end_time: string;
          outcome: string | null;
          outcome_yes_price: number | null;
          volume: number | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["markets"]["Row"], "id" | "created_at"> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["markets"]["Insert"]>;
      };
      price_snapshots: {
        Row: {
          id: number;
          market_id: number;
          recorded_at: string;
          mid_price_yes: number | null;
          best_bid_yes: number | null;
          best_ask_yes: number | null;
          last_trade_price: number | null;
          source: string;
        };
        Insert: Omit<Database["public"]["Tables"]["price_snapshots"]["Row"], "id"> & {
          id?: number;
          source?: string;
        };
        Update: Partial<Database["public"]["Tables"]["price_snapshots"]["Insert"]>;
      };
    };
    Views: {
      market_outcomes: {
        Row: {
          id: number;
          slug: string;
          start_time: string;
          end_time: string;
          outcome: string;
          outcome_binary: number;
          volume: number | null;
        };
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
