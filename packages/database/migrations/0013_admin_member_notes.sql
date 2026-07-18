CREATE TABLE admin_member_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  content text NOT NULL,
  is_internal boolean NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT admin_member_notes_content_not_empty_check CHECK (
    char_length(btrim(content)) > 0
  ),
  CONSTRAINT admin_member_notes_content_max_length_check CHECK (
    char_length(content) <= 5000
  )
);

CREATE INDEX admin_member_notes_member_created_at_idx
  ON admin_member_notes (member_id, created_at);

CREATE TRIGGER admin_member_notes_append_only
  BEFORE UPDATE OR DELETE ON admin_member_notes
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
