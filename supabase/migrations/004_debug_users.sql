-- Debug: Check what users and workspaces exist

-- Log counts
DO $$
DECLARE
  auth_count INTEGER;
  public_count INTEGER;
  workspace_count INTEGER;
  member_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO auth_count FROM auth.users;
  SELECT COUNT(*) INTO public_count FROM public.users;
  SELECT COUNT(*) INTO workspace_count FROM public.workspaces;
  SELECT COUNT(*) INTO member_count FROM public.workspace_members;
  
  RAISE NOTICE 'Auth users: %, Public users: %, Workspaces: %, Members: %', 
    auth_count, public_count, workspace_count, member_count;
END $$;

-- Ensure all auth users have public.users records
INSERT INTO public.users (id, email, name, avatar_url)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'name', au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
  au.raw_user_meta_data->>'avatar_url'
FROM auth.users au
WHERE NOT EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = au.id)
ON CONFLICT (id) DO NOTHING;

-- For each user without a workspace, create one with all the proper records
DO $$
DECLARE
  r RECORD;
  v_workspace_id UUID;
BEGIN
  FOR r IN 
    SELECT u.id as user_id, u.name, u.email
    FROM public.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = u.id)
  LOOP
    RAISE NOTICE 'Creating workspace for user % (%)', r.user_id, r.email;
    
    -- Create workspace
    v_workspace_id := gen_random_uuid();
    
    INSERT INTO public.workspaces (id, name, owner_id, timezone)
    VALUES (v_workspace_id, COALESCE(r.name, 'My') || '''s Workspace', r.user_id, 'America/New_York');
    
    -- Create workspace member (in case trigger didn't fire)
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_workspace_id, r.user_id, 'owner')
    ON CONFLICT DO NOTHING;
    
    -- Create onboarding record (in case trigger didn't fire)
    INSERT INTO public.workspace_onboarding (workspace_id)
    VALUES (v_workspace_id)
    ON CONFLICT DO NOTHING;
    
    -- Create system health record (in case trigger didn't fire)
    INSERT INTO public.system_health (workspace_id)
    VALUES (v_workspace_id)
    ON CONFLICT DO NOTHING;
    
    -- Create default policy (in case trigger didn't fire)
    PERFORM public.create_default_policy(v_workspace_id);
    
    RAISE NOTICE 'Created workspace % for user %', v_workspace_id, r.user_id;
  END LOOP;
END $$;
