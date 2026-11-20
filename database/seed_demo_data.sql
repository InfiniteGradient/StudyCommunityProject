-- StudySphere demo/test data for local XAMPP MySQL/MariaDB
-- IMPORTANT: Run database/schema.sql first, then this file.
-- Intended only for a local TEST database. This script resets demo1/demo2/demo3 passwords
-- and recreates the three groups with the fixed demo slugs below. It does not drop the database.
-- Login credentials:
--   demo1 / demo1demo1  (group owner for the pending-request test)
--   demo2 / demo2demo2  (applicant and second group owner)
--   demo3 / demo3demo3  (extra test account for reports, blocks, and invites)
-- Seed invite token for testing POST /api/invites/accept: 1111111111111111111111111111111111111111111111111111111111111111

USE study_community;
SET NAMES utf8mb4;
SET time_zone = '+00:00';
START TRANSACTION;

-- Demo users use bcrypt-compatible hashes; the application verifies these with bcryptjs.
INSERT INTO users (username, email, password_hash, display_name, account_status, last_login_at) VALUES
('demo1', 'demo1@example.test', '$2b$12$/eVSf7ImzQybazE1dxGFKOOoe/7v8A3t6KomK8i41mJbHajOu.jaC', 'Demo Owner One', 'ACTIVE', UTC_TIMESTAMP(3)),
('demo2', 'demo2@example.test', '$2b$12$jxRgsnczeh9n2eYWqOm.b.t1Jda1hKL7MWMri5w5i86TvxFKw8l/a', 'Demo Student Two', 'ACTIVE', UTC_TIMESTAMP(3)),
('demo3', 'demo3@example.test', '$2b$12$lFukHxLLrZMwfYQ.6T1RgO0HhCXIfpw9Ttd1KWQpS4pQndjoW2v4C', 'Demo Student Three', 'ACTIVE', UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  email = VALUES(email), password_hash = VALUES(password_hash), display_name = VALUES(display_name),
  account_status = 'ACTIVE', last_login_at = VALUES(last_login_at);

SELECT user_id INTO @demo1_id FROM users WHERE username = 'demo1';
SELECT user_id INTO @demo2_id FROM users WHERE username = 'demo2';
SELECT user_id INTO @demo3_id FROM users WHERE username = 'demo3';

-- Remove only this script's demo groups and its demo direct conversation, making re-runs safe.
DELETE FROM study_groups WHERE slug IN (
  'demo-python-private-circle',
  'demo-ml-project-team',
  'demo-algorithms-public-lab'
);
DELETE c FROM conversations c
JOIN direct_conversation_pairs p ON p.conversation_id = c.conversation_id
WHERE p.user_low_id = LEAST(@demo1_id, @demo2_id)
  AND p.user_high_id = GREATEST(@demo1_id, @demo2_id);
DELETE FROM user_blocks
WHERE user_id IN (@demo1_id, @demo2_id, @demo3_id)
   OR blocked_user_id IN (@demo1_id, @demo2_id, @demo3_id);
DELETE FROM notifications
WHERE recipient_user_id IN (@demo1_id, @demo2_id, @demo3_id)
  AND title LIKE 'DEMO SEED:%';

-- Reference data: institution, departments, subjects, topics and learning levels.
INSERT INTO institutions (name, institution_type, city, country, website_url)
VALUES ('Demo University', 'UNIVERSITY', 'Delhi', 'India', 'https://example.test/demo-university')
ON DUPLICATE KEY UPDATE website_url = VALUES(website_url);
SELECT institution_id INTO @inst_id FROM institutions
WHERE name = 'Demo University' AND city = 'Delhi' AND country = 'India';

INSERT INTO departments (institution_id, name) VALUES
(@inst_id, 'Computer Science'), (@inst_id, 'Data Science'), (@inst_id, 'Languages')
ON DUPLICATE KEY UPDATE name = VALUES(name);
SELECT department_id INTO @dept_cs FROM departments WHERE institution_id = @inst_id AND name = 'Computer Science';
SELECT department_id INTO @dept_ds FROM departments WHERE institution_id = @inst_id AND name = 'Data Science';
SELECT department_id INTO @dept_lang FROM departments WHERE institution_id = @inst_id AND name = 'Languages';

INSERT INTO subjects (name, description) VALUES
('Programming', 'Programming languages and software development'),
('Data Science', 'Data analysis, statistics and machine learning'),
('Computer Science', 'Core computer-science subjects'),
('Languages', 'Natural language learning and practice')
ON DUPLICATE KEY UPDATE description = VALUES(description);
SELECT subject_id INTO @sub_prog FROM subjects WHERE name = 'Programming';
SELECT subject_id INTO @sub_ds FROM subjects WHERE name = 'Data Science';
SELECT subject_id INTO @sub_cs FROM subjects WHERE name = 'Computer Science';
SELECT subject_id INTO @sub_lang FROM subjects WHERE name = 'Languages';

INSERT INTO learning_levels (name, `rank`, description) VALUES
('Beginner', 1, 'Learning fundamentals'),
('Intermediate', 2, 'Comfortable with the basics'),
('Advanced', 3, 'Working on deeper and harder concepts'),
('Mixed', 4, 'Welcomes learners at different proficiency levels')
ON DUPLICATE KEY UPDATE description = VALUES(description), `rank` = VALUES(`rank`);
SELECT level_id INTO @lvl_beginner FROM learning_levels WHERE name = 'Beginner';
SELECT level_id INTO @lvl_intermediate FROM learning_levels WHERE name = 'Intermediate';
SELECT level_id INTO @lvl_advanced FROM learning_levels WHERE name = 'Advanced';
SELECT level_id INTO @lvl_mixed FROM learning_levels WHERE name = 'Mixed';

INSERT INTO topics (subject_id, name, description) VALUES
(@sub_prog, 'Python', 'Python fundamentals, scripts and projects'),
(@sub_prog, 'C++', 'C++ programming and problem solving'),
(@sub_ds, 'Machine Learning', 'Models, features and evaluation'),
(@sub_cs, 'Algorithms', 'Searching, sorting and complexity'),
(@sub_cs, 'Database Systems', 'Relational design, SQL and transactions'),
(@sub_lang, 'Japanese', 'Japanese reading and conversation')
ON DUPLICATE KEY UPDATE description = VALUES(description);
SELECT topic_id INTO @topic_python FROM topics WHERE subject_id = @sub_prog AND name = 'Python';
SELECT topic_id INTO @topic_cpp FROM topics WHERE subject_id = @sub_prog AND name = 'C++';
SELECT topic_id INTO @topic_ml FROM topics WHERE subject_id = @sub_ds AND name = 'Machine Learning';
SELECT topic_id INTO @topic_algo FROM topics WHERE subject_id = @sub_cs AND name = 'Algorithms';
SELECT topic_id INTO @topic_db FROM topics WHERE subject_id = @sub_cs AND name = 'Database Systems';
SELECT topic_id INTO @topic_jp FROM topics WHERE subject_id = @sub_lang AND name = 'Japanese';

-- Profile and learning preferences.
INSERT INTO user_profiles (user_id, bio, institution_id, department_id, academic_program, academic_year, timezone, preferred_language) VALUES
(@demo1_id, 'Demo account: owns a private Python study group and manages requests.', @inst_id, @dept_cs, 'B.Tech Computer Science', 2, 'Asia/Kolkata', 'en'),
(@demo2_id, 'Demo account: requests access and collaborates on machine learning.', @inst_id, @dept_ds, 'B.Tech Data Science', 2, 'Asia/Kolkata', 'en'),
(@demo3_id, 'Demo account: tests reports, blocks and invitations.', @inst_id, @dept_lang, 'Language Studies', 1, 'Asia/Kolkata', 'en')
ON DUPLICATE KEY UPDATE bio = VALUES(bio), institution_id = VALUES(institution_id), department_id = VALUES(department_id),
  academic_program = VALUES(academic_program), academic_year = VALUES(academic_year), timezone = VALUES(timezone), preferred_language = VALUES(preferred_language);

INSERT INTO user_subjects (user_id, subject_id, proficiency_level_id, learning_intent) VALUES
(@demo1_id, @sub_prog, @lvl_intermediate, 'BOTH'),
(@demo1_id, @sub_cs, @lvl_beginner, 'LEARN'),
(@demo2_id, @sub_ds, @lvl_intermediate, 'LEARN'),
(@demo2_id, @sub_prog, @lvl_beginner, 'LEARN'),
(@demo3_id, @sub_lang, @lvl_beginner, 'BOTH')
ON DUPLICATE KEY UPDATE proficiency_level_id = VALUES(proficiency_level_id), learning_intent = VALUES(learning_intent);

-- Three discoverable groups: private request flow, private collaborative group, and public group.
INSERT INTO study_groups (owner_user_id, subject_id, level_id, institution_id, name, slug, short_description,
  full_description, group_type, visibility, language_code, max_members, status) VALUES
(@demo1_id, @sub_prog, @lvl_beginner, @inst_id, 'DEMO: Python Private Study Circle', 'demo-python-private-circle',
 'A private beginner-friendly Python study circle.',
 'Demo group for testing private discovery, join requests, owner approval, group chat and resources.',
 'STUDY', 'PRIVATE', 'en', 12, 'OPEN'),
(@demo2_id, @sub_ds, @lvl_intermediate, @inst_id, 'DEMO: Machine Learning Project Team', 'demo-ml-project-team',
 'Work through machine-learning concepts and small experiments.',
 'Demo group for testing approved membership, learning resources, tasks, sessions and group conversation.',
 'PROJECT', 'PRIVATE', 'en', 12, 'OPEN'),
(@demo1_id, @sub_cs, @lvl_advanced, @inst_id, 'DEMO: Algorithms Public Lab', 'demo-algorithms-public-lab',
 'A public space for algorithm practice and peer reviews.',
 'Demo public group for testing discovery, reviews, moderation, reports and multiple group members.',
 'REVISION', 'PUBLIC', 'en', 20, 'OPEN');
SELECT group_id INTO @g_python FROM study_groups WHERE slug = 'demo-python-private-circle';
SELECT group_id INTO @g_ml FROM study_groups WHERE slug = 'demo-ml-project-team';
SELECT group_id INTO @g_algo FROM study_groups WHERE slug = 'demo-algorithms-public-lab';

INSERT INTO group_topics (group_id, topic_id) VALUES
(@g_python, @topic_python), (@g_python, @topic_cpp),
(@g_ml, @topic_ml), (@g_ml, @topic_python),
(@g_algo, @topic_algo), (@g_algo, @topic_db)
ON DUPLICATE KEY UPDATE topic_id = VALUES(topic_id);

INSERT INTO saved_groups (user_id, group_id) VALUES
(@demo2_id, @g_python), (@demo1_id, @g_ml)
ON DUPLICATE KEY UPDATE saved_at = CURRENT_TIMESTAMP(3);

INSERT INTO group_memberships (group_id, user_id, role, status) VALUES
(@g_python, @demo1_id, 'OWNER', 'ACTIVE'),
(@g_ml, @demo2_id, 'OWNER', 'ACTIVE'),
(@g_ml, @demo1_id, 'MEMBER', 'ACTIVE'),
(@g_algo, @demo1_id, 'OWNER', 'ACTIVE'),
(@g_algo, @demo2_id, 'MEMBER', 'ACTIVE'),
(@g_algo, @demo3_id, 'MEMBER', 'ACTIVE')
ON DUPLICATE KEY UPDATE role = VALUES(role), status = VALUES(status), joined_at = CURRENT_TIMESTAMP(3), left_at = NULL;

-- Critical test row: demo2 has a PENDING request to demo1's private group.
-- Extra rows demonstrate approved and rejected histories.
INSERT INTO join_requests (group_id, user_id, message, status, decided_at, decided_by_user_id) VALUES
(@g_python, @demo2_id, 'Hi! I am learning Python and would like to practise with the group.', 'PENDING', NULL, NULL),
(@g_python, @demo3_id, 'I would like to join this Python circle.', 'REJECTED', UTC_TIMESTAMP(3), @demo1_id),
(@g_ml, @demo1_id, 'I would like to collaborate on machine-learning exercises.', 'APPROVED', UTC_TIMESTAMP(3), @demo2_id);

INSERT INTO group_invites (group_id, inviter_user_id, invitee_user_id, invite_email, invite_token_hash, status, expires_at)
VALUES (@g_ml, @demo2_id, @demo3_id, NULL,
  '3138bb9bc78df27c473ecfd1410f7bd45ebac1f59cf3ff9cfe4db77aab7aedd3',
  'PENDING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY));

INSERT INTO group_rules (group_id, title, rule_text, sort_order) VALUES
(@g_python, 'Be respectful', 'Be kind, constructive, and respectful when helping other learners.', 1),
(@g_python, 'Keep it educational', 'Share learning-focused questions, examples and resources.', 2),
(@g_ml, 'Explain your reasoning', 'When sharing an answer, include the reasoning or experiment behind it.', 1),
(@g_algo, 'Show your work', 'When asking for help, include your approach and where you got stuck.', 1);

INSERT INTO group_reviews (group_id, reviewer_user_id, rating, comment) VALUES
(@g_algo, @demo2_id, 5, 'Clear discussions and helpful peer explanations.'),
(@g_algo, @demo3_id, 4, 'Good place to practise algorithms with other learners.');

-- Seeded group conversations and participants, mirroring what the application creates for a group.
INSERT INTO conversations (conversation_type, study_group_id, created_by_user_id) VALUES
('GROUP', @g_python, @demo1_id),
('GROUP', @g_ml, @demo2_id),
('GROUP', @g_algo, @demo1_id);
SELECT conversation_id INTO @conv_python FROM conversations WHERE study_group_id = @g_python;
SELECT conversation_id INTO @conv_ml FROM conversations WHERE study_group_id = @g_ml;
SELECT conversation_id INTO @conv_algo FROM conversations WHERE study_group_id = @g_algo;
INSERT INTO conversation_members (conversation_id, user_id) VALUES
(@conv_python, @demo1_id),
(@conv_ml, @demo1_id), (@conv_ml, @demo2_id),
(@conv_algo, @demo1_id), (@conv_algo, @demo2_id), (@conv_algo, @demo3_id)
ON DUPLICATE KEY UPDATE archived_at = NULL;

-- Direct message conversation between demo1 and demo2.
INSERT INTO conversations (conversation_type, study_group_id, created_by_user_id)
VALUES ('DIRECT', NULL, @demo1_id);
SET @conv_dm = LAST_INSERT_ID();
INSERT INTO direct_conversation_pairs (conversation_id, user_low_id, user_high_id)
VALUES (@conv_dm, LEAST(@demo1_id, @demo2_id), GREATEST(@demo1_id, @demo2_id));
INSERT INTO conversation_members (conversation_id, user_id) VALUES
(@conv_dm, @demo1_id), (@conv_dm, @demo2_id);

INSERT INTO messages (conversation_id, sender_user_id, body, message_type) VALUES
(@conv_python, @demo1_id, 'DEMO SEED: Welcome to the private Python study circle.', 'TEXT'),
(@conv_ml, @demo2_id, 'DEMO SEED: I have shared the starter notebook in resources.', 'TEXT'),
(@conv_ml, @demo1_id, 'DEMO SEED: Great, I will review the model evaluation section.', 'TEXT'),
(@conv_algo, @demo1_id, 'DEMO SEED: This week we are practising sorting and binary search.', 'TEXT'),
(@conv_algo, @demo2_id, 'DEMO SEED: I will post my complexity analysis after practice.', 'TEXT'),
(@conv_algo, @demo3_id, 'DEMO SEED: Can someone review my algorithm approach?', 'TEXT'),
(@conv_dm, @demo1_id, 'DEMO SEED: Hey demo2, shall we study after class?', 'TEXT'),
(@conv_dm, @demo2_id, 'DEMO SEED: Yes! I will bring the machine-learning notes.', 'TEXT');
SELECT message_id INTO @msg_python FROM messages WHERE conversation_id = @conv_python AND body = 'DEMO SEED: Welcome to the private Python study circle.' LIMIT 1;
SELECT message_id INTO @msg_ml_resource FROM messages WHERE conversation_id = @conv_ml AND body = 'DEMO SEED: I have shared the starter notebook in resources.' LIMIT 1;
SELECT message_id INTO @msg_ml_reply FROM messages WHERE conversation_id = @conv_ml AND body = 'DEMO SEED: Great, I will review the model evaluation section.' LIMIT 1;
SELECT message_id INTO @msg_algo_owner FROM messages WHERE conversation_id = @conv_algo AND body = 'DEMO SEED: This week we are practising sorting and binary search.' LIMIT 1;
SELECT message_id INTO @msg_algo_demo2 FROM messages WHERE conversation_id = @conv_algo AND body = 'DEMO SEED: I will post my complexity analysis after practice.' LIMIT 1;
SELECT message_id INTO @msg_algo_demo3 FROM messages WHERE conversation_id = @conv_algo AND body = 'DEMO SEED: Can someone review my algorithm approach?' LIMIT 1;
SELECT message_id INTO @msg_dm1 FROM messages WHERE conversation_id = @conv_dm AND body = 'DEMO SEED: Hey demo2, shall we study after class?' LIMIT 1;
SELECT message_id INTO @msg_dm2 FROM messages WHERE conversation_id = @conv_dm AND body = 'DEMO SEED: Yes! I will bring the machine-learning notes.' LIMIT 1;
UPDATE conversations c SET last_message_at = (SELECT MAX(m.sent_at) FROM messages m WHERE m.conversation_id = c.conversation_id)
WHERE c.conversation_id IN (@conv_python, @conv_ml, @conv_algo, @conv_dm);

-- Attachment metadata only: this does not create a physical file in storage.
INSERT INTO message_attachments (message_id, uploaded_by_user_id, original_filename, mime_type, size_bytes, storage_key)
VALUES (@msg_ml_resource, @demo2_id, 'demo-ml-starter-notes.pdf', 'application/pdf', 2048, 'demo-seed/attachments/demo-ml-starter-notes.pdf');

INSERT INTO message_reactions (message_id, user_id, reaction_code) VALUES
(@msg_ml_resource, @demo1_id, '👍'), (@msg_ml_reply, @demo2_id, '💡'), (@msg_algo_demo3, @demo2_id, '✅');
INSERT INTO message_read_receipts (message_id, user_id) VALUES
(@msg_ml_resource, @demo1_id), (@msg_ml_reply, @demo2_id), (@msg_dm1, @demo2_id), (@msg_dm2, @demo1_id);

-- A block between demo2 and demo3 tests safety without breaking demo1<->demo2 DMs.
INSERT INTO user_blocks (user_id, blocked_user_id) VALUES (@demo2_id, @demo3_id);

-- Study sessions and attendee rows.
INSERT INTO study_sessions (group_id, created_by_user_id, title, description, starts_at, ends_at, location_mode, meeting_url, location_text, status) VALUES
(@g_ml, @demo2_id, 'DEMO: Model evaluation study session', 'Review train/test split, metrics and error analysis.', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 3 DAY), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 3 DAY) + INTERVAL 90 MINUTE, 'ONLINE', 'https://example.test/demo-meeting-ml', NULL, 'SCHEDULED'),
(@g_algo, @demo1_id, 'DEMO: Algorithms problem-solving hour', 'Work through binary search and sorting exercises.', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 DAY), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 DAY) + INTERVAL 60 MINUTE, 'HYBRID', 'https://example.test/demo-meeting-algo', 'Demo University library', 'SCHEDULED');
SELECT session_id INTO @session_ml FROM study_sessions WHERE group_id = @g_ml AND title = 'DEMO: Model evaluation study session' LIMIT 1;
SELECT session_id INTO @session_algo FROM study_sessions WHERE group_id = @g_algo AND title = 'DEMO: Algorithms problem-solving hour' LIMIT 1;
INSERT INTO session_attendees (session_id, user_id, status) VALUES
(@session_ml, @demo1_id, 'REGISTERED'), (@session_ml, @demo2_id, 'REGISTERED'),
(@session_algo, @demo1_id, 'REGISTERED'), (@session_algo, @demo2_id, 'ATTENDED'), (@session_algo, @demo3_id, 'REGISTERED');

INSERT INTO group_resources (group_id, uploaded_by_user_id, title, description, resource_type, resource_url, is_pinned) VALUES
(@g_python, @demo1_id, 'Python official tutorial', 'Reference tutorial for Python basics.', 'LINK', 'https://docs.python.org/3/tutorial/', TRUE),
(@g_ml, @demo2_id, 'Demo ML starter notebook', 'Placeholder link for a starter notebook used in UI testing.', 'CODE', 'https://example.test/demo-ml-notebook', TRUE),
(@g_ml, @demo1_id, 'Model evaluation checklist', 'A checklist for comparing classification metrics.', 'NOTE', 'https://example.test/demo-evaluation-checklist', FALSE),
(@g_algo, @demo2_id, 'Sorting visualisation reference', 'Reference material for sorting algorithms.', 'LINK', 'https://visualgo.net/en/sorting', FALSE);

INSERT INTO study_tasks (group_id, created_by_user_id, title, description, due_at, status) VALUES
(@g_ml, @demo2_id, 'DEMO: Compare two classification models', 'Record accuracy, precision, recall and confusion matrix.', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 4 DAY), 'OPEN'),
(@g_ml, @demo1_id, 'DEMO: Prepare evaluation notes', 'Summarise when each evaluation metric is useful.', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 6 DAY), 'IN_PROGRESS'),
(@g_algo, @demo1_id, 'DEMO: Implement binary search', 'Write tests for found and not-found cases.', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 2 DAY), 'OPEN');
SELECT task_id INTO @task_ml_compare FROM study_tasks WHERE group_id = @g_ml AND title = 'DEMO: Compare two classification models' LIMIT 1;
SELECT task_id INTO @task_ml_notes FROM study_tasks WHERE group_id = @g_ml AND title = 'DEMO: Prepare evaluation notes' LIMIT 1;
SELECT task_id INTO @task_algo FROM study_tasks WHERE group_id = @g_algo AND title = 'DEMO: Implement binary search' LIMIT 1;
INSERT INTO task_assignees (task_id, user_id, status, completed_at) VALUES
(@task_ml_compare, @demo1_id, 'IN_PROGRESS', NULL),
(@task_ml_compare, @demo2_id, 'ASSIGNED', NULL),
(@task_ml_notes, @demo2_id, 'ASSIGNED', NULL),
(@task_algo, @demo2_id, 'COMPLETED', UTC_TIMESTAMP(3));

INSERT INTO notifications (recipient_user_id, actor_user_id, notification_type, title, body, payload) VALUES
(@demo1_id, @demo2_id, 'GROUP_JOIN_REQUEST', 'DEMO SEED: New join request', 'demo2 requested to join the Python Private Study Circle.', JSON_OBJECT('group_id', @g_python)),
(@demo2_id, @demo1_id, 'GROUP_JOIN_APPROVED', 'DEMO SEED: Request approved', 'Your seeded ML group request was approved.', JSON_OBJECT('group_id', @g_ml)),
(@demo3_id, @demo2_id, 'GROUP_INVITE', 'DEMO SEED: Study group invitation', 'demo2 invited you to the Machine Learning Project Team.', JSON_OBJECT('group_id', @g_ml, 'invite_token', '1111111111111111111111111111111111111111111111111111111111111111'));

INSERT INTO reports (reporter_user_id, target_user_id, group_id, message_id, reason, details, status) VALUES
(@demo2_id, @demo3_id, @g_algo, @msg_algo_demo3, 'SPAM', 'DEMO SEED: Example report row for testing the reports workflow.', 'OPEN');
INSERT INTO moderation_actions (group_id, moderator_user_id, target_user_id, action_type, reason, starts_at, expires_at) VALUES
(@g_algo, @demo1_id, @demo3_id, 'WARNING', 'DEMO SEED: Sample moderation audit entry.', UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 DAY));

COMMIT;

-- Quick sanity checks: results should show users/groups/pending requests and counts in all 32 tables.
SELECT username, email, display_name, account_status FROM users WHERE username IN ('demo1','demo2','demo3') ORDER BY username;
SELECT group_id, name, slug, visibility, status FROM study_groups WHERE slug LIKE 'demo-%' ORDER BY group_id;
SELECT jr.request_id, g.name AS group_name, u.username, jr.status, jr.message
FROM join_requests jr JOIN study_groups g ON g.group_id = jr.group_id JOIN users u ON u.user_id = jr.user_id
WHERE g.slug IN ('demo-python-private-circle','demo-ml-project-team','demo-algorithms-public-lab')
ORDER BY jr.created_at;
SELECT 'users' AS table_name, COUNT(*) AS rows_for_demo FROM users WHERE username IN ('demo1','demo2','demo3')
UNION ALL SELECT 'institutions', COUNT(*) FROM institutions WHERE name = 'Demo University'
UNION ALL SELECT 'departments', COUNT(*) FROM departments WHERE institution_id = @inst_id AND name IN ('Computer Science','Data Science','Languages')
UNION ALL SELECT 'user_profiles', COUNT(*) FROM user_profiles WHERE user_id IN (@demo1_id,@demo2_id,@demo3_id)
UNION ALL SELECT 'subjects', COUNT(*) FROM subjects WHERE name IN ('Programming','Data Science','Computer Science','Languages')
UNION ALL SELECT 'topics', COUNT(*) FROM topics WHERE topic_id IN (@topic_python,@topic_cpp,@topic_ml,@topic_algo,@topic_db,@topic_jp)
UNION ALL SELECT 'learning_levels', COUNT(*) FROM learning_levels WHERE name IN ('Beginner','Intermediate','Advanced','Mixed')
UNION ALL SELECT 'user_subjects', COUNT(*) FROM user_subjects WHERE user_id IN (@demo1_id,@demo2_id,@demo3_id)
UNION ALL SELECT 'study_groups', COUNT(*) FROM study_groups WHERE slug LIKE 'demo-%'
UNION ALL SELECT 'group_topics', COUNT(*) FROM group_topics WHERE group_id IN (@g_python,@g_ml,@g_algo)
UNION ALL SELECT 'saved_groups', COUNT(*) FROM saved_groups WHERE user_id IN (@demo1_id,@demo2_id) AND group_id IN (@g_python,@g_ml,@g_algo)
UNION ALL SELECT 'group_memberships', COUNT(*) FROM group_memberships WHERE group_id IN (@g_python,@g_ml,@g_algo)
UNION ALL SELECT 'join_requests', COUNT(*) FROM join_requests WHERE group_id IN (@g_python,@g_ml,@g_algo)
UNION ALL SELECT 'group_invites', COUNT(*) FROM group_invites WHERE group_id = @g_ml AND inviter_user_id = @demo2_id
UNION ALL SELECT 'group_rules', COUNT(*) FROM group_rules WHERE group_id IN (@g_python,@g_ml,@g_algo)
UNION ALL SELECT 'group_reviews', COUNT(*) FROM group_reviews WHERE group_id = @g_algo
UNION ALL SELECT 'study_sessions', COUNT(*) FROM study_sessions WHERE group_id IN (@g_ml,@g_algo)
UNION ALL SELECT 'session_attendees', COUNT(*) FROM session_attendees WHERE session_id IN (@session_ml,@session_algo)
UNION ALL SELECT 'group_resources', COUNT(*) FROM group_resources WHERE group_id IN (@g_python,@g_ml,@g_algo)
UNION ALL SELECT 'study_tasks', COUNT(*) FROM study_tasks WHERE group_id IN (@g_ml,@g_algo)
UNION ALL SELECT 'task_assignees', COUNT(*) FROM task_assignees WHERE task_id IN (@task_ml_compare,@task_ml_notes,@task_algo)
UNION ALL SELECT 'conversations', COUNT(*) FROM conversations WHERE conversation_id IN (@conv_python,@conv_ml,@conv_algo,@conv_dm)
UNION ALL SELECT 'direct_conversation_pairs', COUNT(*) FROM direct_conversation_pairs WHERE conversation_id = @conv_dm
UNION ALL SELECT 'conversation_members', COUNT(*) FROM conversation_members WHERE conversation_id IN (@conv_python,@conv_ml,@conv_algo,@conv_dm)
UNION ALL SELECT 'messages', COUNT(*) FROM messages WHERE message_id IN (@msg_python,@msg_ml_resource,@msg_ml_reply,@msg_algo_owner,@msg_algo_demo2,@msg_algo_demo3,@msg_dm1,@msg_dm2)
UNION ALL SELECT 'message_attachments', COUNT(*) FROM message_attachments WHERE message_id = @msg_ml_resource
UNION ALL SELECT 'message_reactions', COUNT(*) FROM message_reactions WHERE message_id IN (@msg_ml_resource,@msg_ml_reply,@msg_algo_demo3)
UNION ALL SELECT 'message_read_receipts', COUNT(*) FROM message_read_receipts WHERE message_id IN (@msg_ml_resource,@msg_ml_reply,@msg_dm1,@msg_dm2)
UNION ALL SELECT 'user_blocks', COUNT(*) FROM user_blocks WHERE user_id = @demo2_id AND blocked_user_id = @demo3_id
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications WHERE title LIKE 'DEMO SEED:%' AND recipient_user_id IN (@demo1_id,@demo2_id,@demo3_id)
UNION ALL SELECT 'reports', COUNT(*) FROM reports WHERE reporter_user_id = @demo2_id AND group_id = @g_algo AND details LIKE 'DEMO SEED:%'
UNION ALL SELECT 'moderation_actions', COUNT(*) FROM moderation_actions WHERE group_id = @g_algo AND reason LIKE 'DEMO SEED:%'
ORDER BY table_name;
