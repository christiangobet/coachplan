DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'UserRole' AND e.enumlabel = 'ADMIN'
  ) THEN
    ALTER TYPE "UserRole" ADD VALUE 'ADMIN';
  END IF;
END
$$;
