-- Fix handle_new_user to also create a workspace

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_workspace_id UUID;
  v_user_name TEXT;
BEGIN
  -- Get user name
  v_user_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  
  -- Create user profile
  INSERT INTO public.users (id, email, name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    v_user_name,
    NEW.raw_user_meta_data->>'avatar_url'
  );
  
  -- Create default workspace for the user
  INSERT INTO public.workspaces (name, owner_id, timezone)
  VALUES (v_user_name || '''s Workspace', NEW.id, 'America/New_York')
  RETURNING id INTO v_workspace_id;
  
  -- Note: The init_workspace trigger will automatically:
  -- 1. Add the user as workspace owner
  -- 2. Create onboarding record
  -- 3. Create system health record
  -- 4. Create default reminder policy
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also create workspaces for any existing users who don't have one
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
    
    -- Note: init_workspace trigger handles the rest
  END LOOP;
END $$;
