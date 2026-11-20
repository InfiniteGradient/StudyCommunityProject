-- Read-only checks after importing schema.sql and seed_demo_data.sql.
USE study_community;

-- 1) Demo users (passwords are intentionally predictable and local-only).
SELECT user_id, username, email, account_status
FROM users
WHERE username IN ('demo1', 'demo2', 'demo3')
ORDER BY username;

-- 2) Seeded demo groups and visibility.
SELECT group_id, name, slug, visibility, status
FROM study_groups
WHERE slug IN ('demo-python-private-circle', 'demo-ml-project-team', 'demo-algorithms-public-lab')
ORDER BY group_id;

-- 3) Primary workflow: demo2 should have one PENDING request for demo1's Python group.
SELECT jr.request_id, g.name AS group_name, requester.username AS requester,
       jr.status, jr.message, jr.created_at
FROM join_requests jr
JOIN study_groups g ON g.group_id = jr.group_id
JOIN users requester ON requester.user_id = jr.user_id
WHERE g.slug = 'demo-python-private-circle'
ORDER BY jr.created_at, jr.request_id;

-- 4) Active member list for all demo groups.
SELECT g.name AS group_name, u.username, gm.role, gm.status AS membership_status
FROM group_memberships gm
JOIN study_groups g ON g.group_id = gm.group_id
JOIN users u ON u.user_id = gm.user_id
WHERE g.slug LIKE 'demo-%'
ORDER BY g.name, gm.role, u.username;

-- 5) Data coverage for the key application features.
SELECT 'group conversations' AS feature, COUNT(*) AS row_count
FROM conversations c JOIN study_groups g ON g.group_id = c.study_group_id WHERE g.slug LIKE 'demo-%'
UNION ALL
SELECT 'messages', COUNT(*) FROM messages m JOIN conversations c ON c.conversation_id = m.conversation_id
WHERE c.study_group_id IN (SELECT group_id FROM study_groups WHERE slug LIKE 'demo-%')
   OR c.conversation_id IN (SELECT d.conversation_id FROM direct_conversation_pairs d
      JOIN users u1 ON u1.user_id = d.user_low_id JOIN users u2 ON u2.user_id = d.user_high_id
      WHERE u1.username = 'demo1' AND u2.username = 'demo2')
UNION ALL
SELECT 'resources', COUNT(*) FROM group_resources r JOIN study_groups g ON g.group_id = r.group_id WHERE g.slug LIKE 'demo-%'
UNION ALL
SELECT 'tasks', COUNT(*) FROM study_tasks t JOIN study_groups g ON g.group_id = t.group_id WHERE g.slug LIKE 'demo-%'
UNION ALL
SELECT 'sessions', COUNT(*) FROM study_sessions ss JOIN study_groups g ON g.group_id = ss.group_id WHERE g.slug LIKE 'demo-%'
UNION ALL
SELECT 'reports', COUNT(*) FROM reports WHERE details LIKE 'DEMO SEED:%'
UNION ALL
SELECT 'moderation actions', COUNT(*) FROM moderation_actions WHERE reason LIKE 'DEMO SEED:%';

-- 6) After accepting demo2's request, this should show ACTIVE membership.
-- Run this query again after clicking Accept in the app.
SELECT g.name AS group_name, u.username, gm.role, gm.status
FROM group_memberships gm
JOIN study_groups g ON g.group_id = gm.group_id
JOIN users u ON u.user_id = gm.user_id
WHERE g.slug = 'demo-python-private-circle' AND u.username = 'demo2';
