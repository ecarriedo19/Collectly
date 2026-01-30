-- Sync existing auth.users to public.users and create workspaces

-- First, create public.users records for any auth.users that don't have one
INSERT INTO public.users (id, email, name, avatar_url)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'name', au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
  au.raw_user_meta_data->>'avatar_url'
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.users pu WHERE pu.id = au.id
)
ON CONFLICT (id) DO NOTHING;

-- Then, create workspaces for users who don't have one
DO $$
DECLARE
  r RECORD;
  v_workspace_id UUID;
BEGIN
  FOR r IN 
    SELECT u.id, u.name 
    FROM public.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = u.id
    )
  LOOP
    -- Create workspace
    INSERT INTO public.workspaces (name, owner_id, timezone)
    VALUES (COALESCE(r.name, 'My') || '''s Workspace', r.id, 'America/New_York')
    RETURNING id INTO v_workspace_id;
    
    RAISE NOTICE 'Created workspace % for user %', v_workspace_id, r.id;
  END LOOP;
END $$;
