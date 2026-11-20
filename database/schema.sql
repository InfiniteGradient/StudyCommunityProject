-- Study Community Platform - MySQL 8.0+ / modern MariaDB (XAMPP)
-- Import via phpMyAdmin or: mysql -u root -p < database/schema.sql
-- All application timestamps are stored as UTC by convention.
CREATE DATABASE IF NOT EXISTS study_community CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE study_community;
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Study Community Platform schema (converted to MySQL/MariaDB)
-- Run in a new database. Enum-like values are VARCHAR + CHECK constraints for easy migration.
-- Files should be stored in object storage; save opaque storage keys/URLs in the database.

CREATE TABLE users (
  user_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(30) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  account_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (account_status IN ('ACTIVE','SUSPENDED','DEACTIVATED','PENDING_VERIFICATION')),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE institutions (
  institution_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  institution_type VARCHAR(30) NOT NULL DEFAULT 'OTHER'
        CHECK (institution_type IN ('UNIVERSITY','COLLEGE','SCHOOL','TRAINING_CENTER','OTHER')),
  city VARCHAR(100),
  country VARCHAR(100),
  website_url TEXT,
  UNIQUE (name, city, country)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE departments (
  department_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  institution_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  UNIQUE (institution_id, name),
  UNIQUE (department_id, institution_id),
  FOREIGN KEY (institution_id) REFERENCES institutions(institution_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  bio TEXT,
  avatar_url TEXT,
  institution_id BIGINT UNSIGNED,
  department_id BIGINT UNSIGNED,
  academic_program VARCHAR(120),
  academic_year SMALLINT CHECK (academic_year BETWEEN 1 AND 15),
  timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
  preferred_language VARCHAR(10) NOT NULL DEFAULT 'en',
  FOREIGN KEY (department_id, institution_id)
        REFERENCES departments(department_id, institution_id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (institution_id) REFERENCES institutions(institution_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subjects (
  subject_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  description TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE topics (
  topic_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  UNIQUE (subject_id, name),
  UNIQUE (topic_id, subject_id),
  FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE learning_levels (
  level_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(40) NOT NULL UNIQUE,
  `rank` SMALLINT NOT NULL UNIQUE CHECK (`rank` > 0),
  description TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_subjects (
  user_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  proficiency_level_id BIGINT UNSIGNED,
  learning_intent VARCHAR(16) NOT NULL DEFAULT 'LEARN'
        CHECK (learning_intent IN ('LEARN','TEACH','BOTH')),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, subject_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE,
  FOREIGN KEY (proficiency_level_id) REFERENCES learning_levels(level_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE study_groups (
  group_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  level_id BIGINT UNSIGNED NOT NULL,
  institution_id BIGINT UNSIGNED,
  name VARCHAR(140) NOT NULL,
  slug VARCHAR(160) NOT NULL UNIQUE,
  short_description VARCHAR(250),
  full_description TEXT,
  group_type VARCHAR(20) NOT NULL DEFAULT 'STUDY'
        CHECK (group_type IN ('STUDY','EXAM_PREP','PROJECT','REVISION','HOMEWORK','LANGUAGE_EXCHANGE')),
  visibility VARCHAR(10) NOT NULL DEFAULT 'PUBLIC'
        CHECK (visibility IN ('PUBLIC','PRIVATE','UNLISTED')),
  language_code VARCHAR(10) NOT NULL DEFAULT 'en',
  max_members SMALLINT NOT NULL DEFAULT 30 CHECK (max_members BETWEEN 2 AND 1000),
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','FULL','CLOSED','ARCHIVED')),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (level_id) REFERENCES learning_levels(level_id) ON DELETE RESTRICT,
  FOREIGN KEY (institution_id) REFERENCES institutions(institution_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE group_topics (
  group_id BIGINT UNSIGNED NOT NULL,
  topic_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (group_id, topic_id),
  FOREIGN KEY (group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (topic_id) REFERENCES topics(topic_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE saved_groups (
  user_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  saved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, group_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE group_memberships (
  group_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER','MODERATOR','MEMBER')),
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LEFT','REMOVED','BANNED')),
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  left_at DATETIME(3),
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE join_requests (
  request_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  message TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  pending_user_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status = 'PENDING' THEN user_id ELSE NULL END) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_at DATETIME(3),
  decided_by_user_id BIGINT UNSIGNED,
  UNIQUE KEY uq_pending_join_request (group_id, pending_user_id),
  FOREIGN KEY (group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE group_invites (
  invite_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  inviter_user_id BIGINT UNSIGNED NOT NULL,
  invitee_user_id BIGINT UNSIGNED,
  invite_email VARCHAR(255),
  invite_token_hash VARCHAR(512) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','ACCEPTED','DECLINED','REVOKED','EXPIRED')),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  CHECK ((invitee_user_id IS NOT NULL AND invite_email IS NULL) OR
           (invitee_user_id IS NULL AND invite_email IS NOT NULL)),
  FOREIGN KEY (group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (inviter_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (invitee_user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE group_rules (
  rule_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  rule_text TEXT NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  FOREIGN KEY (group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE group_reviews (
  review_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  reviewer_user_id BIGINT UNSIGNED NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (group_id, reviewer_user_id),
  FOREIGN KEY (group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE study_sessions (
  session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  location_mode VARCHAR(16) NOT NULL DEFAULT 'ONLINE'
        CHECK (location_mode IN ('ONLINE','IN_PERSON','HYBRID')),
  meeting_url TEXT,
  location_text TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED'
        CHECK (status IN ('SCHEDULED','CANCELLED','COMPLETED')),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE session_attendees (
  session_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'REGISTERED'
        CHECK (status IN ('REGISTERED','ATTENDED','NO_SHOW','CANCELLED')),
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id) REFERENCES study_sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE group_resources (
  resource_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  resource_type VARCHAR(20) NOT NULL
        CHECK (resource_type IN ('LINK','DOCUMENT','VIDEO','NOTE','CODE','OTHER')),
  resource_url TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE study_tasks (
  task_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  due_at DATETIME(3),
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE task_assignees (
  task_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ASSIGNED'
        CHECK (status IN ('ASSIGNED','IN_PROGRESS','COMPLETED')),
  completed_at DATETIME(3),
  PRIMARY KEY (task_id, user_id),
  FOREIGN KEY (task_id) REFERENCES study_tasks(task_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE conversations (
  conversation_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_type VARCHAR(10) NOT NULL CHECK (conversation_type IN ('DIRECT','GROUP')),
  study_group_id BIGINT UNSIGNED UNIQUE,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_message_at DATETIME(3),
  CHECK ((conversation_type = 'GROUP' AND study_group_id IS NOT NULL) OR
           (conversation_type = 'DIRECT' AND study_group_id IS NULL)),
  FOREIGN KEY (study_group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE direct_conversation_pairs (
  conversation_id BIGINT UNSIGNED PRIMARY KEY,
  user_low_id BIGINT UNSIGNED NOT NULL,
  user_high_id BIGINT UNSIGNED NOT NULL,
  UNIQUE (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (user_low_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (user_high_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE conversation_members (
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_read_at DATETIME(3),
  muted_until DATETIME(3),
  archived_at DATETIME(3),
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE messages (
  message_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT UNSIGNED NOT NULL,
  sender_user_id BIGINT UNSIGNED NOT NULL,
  reply_to_message_id BIGINT UNSIGNED,
  body TEXT,
  message_type VARCHAR(16) NOT NULL DEFAULT 'TEXT'
        CHECK (message_type IN ('TEXT','SYSTEM','IMAGE','FILE','LINK')),
  sent_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  edited_at DATETIME(3),
  deleted_at DATETIME(3),
  CHECK (body IS NOT NULL OR message_type IN ('IMAGE','FILE')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (sender_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (reply_to_message_id) REFERENCES messages(message_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE message_attachments (
  attachment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT UNSIGNED NOT NULL,
  uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL CHECK (size_bytes >= 0),
  storage_key VARCHAR(512) NOT NULL UNIQUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE message_reactions (
  message_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  reaction_code VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (message_id, user_id, reaction_code),
  FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE message_read_receipts (
  message_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  read_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_blocks (
  user_id BIGINT UNSIGNED NOT NULL,
  blocked_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, blocked_user_id),
  CHECK (user_id <> blocked_user_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  notification_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recipient_user_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED,
  notification_type VARCHAR(40) NOT NULL,
  title VARCHAR(160) NOT NULL,
  body TEXT,
  payload JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at DATETIME(3),
  FOREIGN KEY (recipient_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reports (
  report_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reporter_user_id BIGINT UNSIGNED NOT NULL,
  target_user_id BIGINT UNSIGNED,
  group_id BIGINT UNSIGNED,
  message_id BIGINT UNSIGNED,
  reason VARCHAR(40) NOT NULL,
  details TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED','DISMISSED')),
  reviewed_by_user_id BIGINT UNSIGNED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_at DATETIME(3),
  CHECK (target_user_id IS NOT NULL OR group_id IS NOT NULL OR message_id IS NOT NULL),
  FOREIGN KEY (reporter_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE moderation_actions (
  action_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED,
  moderator_user_id BIGINT UNSIGNED NOT NULL,
  target_user_id BIGINT UNSIGNED NOT NULL,
  action_type VARCHAR(20) NOT NULL CHECK (action_type IN ('WARNING','MUTE','REMOVE','BAN','UNBAN')),
  reason TEXT,
  starts_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CHECK (expires_at IS NULL OR expires_at > starts_at),
  FOREIGN KEY (group_id) REFERENCES study_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (moderator_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (target_user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



-- Search, membership, timeline, and chat indexes
CREATE INDEX idx_groups_discovery ON study_groups(subject_id, level_id, visibility, status);
CREATE INDEX idx_groups_institution ON study_groups(institution_id);
CREATE INDEX idx_groups_created_at ON study_groups(created_at DESC);
CREATE INDEX idx_group_memberships_user_status ON group_memberships(user_id, status);
CREATE INDEX idx_group_memberships_group_status ON group_memberships(group_id, status);
CREATE INDEX idx_join_requests_group_status ON join_requests(group_id, status, created_at DESC);
CREATE INDEX idx_sessions_group_start ON study_sessions(group_id, starts_at);
CREATE INDEX idx_tasks_group_status_due ON study_tasks(group_id, status, due_at);
CREATE INDEX idx_messages_conversation_sent ON messages(conversation_id, sent_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_user_id, sent_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(recipient_user_id, read_at, created_at DESC);
CREATE INDEX idx_reports_status ON reports(status, created_at DESC);
CREATE INDEX idx_moderation_target ON moderation_actions(target_user_id, created_at DESC);

-- Reference data makes the app usable immediately after import.
INSERT INTO subjects (name, description) VALUES
  ('Programming', 'Programming languages and software development'),
  ('Mathematics', 'Mathematics for computing and general study'),
  ('Data Science', 'Data analysis, statistics, and machine learning'),
  ('Computer Science', 'Core computer science subjects'),
  ('Languages', 'Natural language learning and practice'),
  ('Design', 'UI, UX, and visual design')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO learning_levels (name, `rank`, description) VALUES
  ('Beginner', 1, 'Learning fundamentals and core vocabulary'),
  ('Intermediate', 2, 'Comfortable with basics; building independent skills'),
  ('Advanced', 3, 'Deepening expertise and solving harder problems'),
  ('Mixed', 4, 'Welcomes learners across multiple proficiency levels')
ON DUPLICATE KEY UPDATE description = VALUES(description), `rank` = VALUES(`rank`);

INSERT INTO topics (subject_id, name, description)
SELECT s.subject_id, v.topic_name, v.topic_description
FROM subjects s
JOIN (
  SELECT 'Programming' AS subject_name, 'Python' AS topic_name, 'Python fundamentals, scripts, and projects' AS topic_description UNION ALL
  SELECT 'Programming', 'C++', 'C++ programming and problem solving' UNION ALL
  SELECT 'Programming', 'JavaScript', 'JavaScript and web development' UNION ALL
  SELECT 'Mathematics', 'Linear Algebra', 'Vectors, matrices, and transformations' UNION ALL
  SELECT 'Mathematics', 'Probability', 'Probability theory and random variables' UNION ALL
  SELECT 'Data Science', 'Machine Learning', 'Models, features, and evaluation' UNION ALL
  SELECT 'Data Science', 'Deep Learning', 'Neural networks and representation learning' UNION ALL
  SELECT 'Computer Science', 'Database Systems', 'Relational design, SQL, and transactions' UNION ALL
  SELECT 'Computer Science', 'Algorithms', 'Searching, sorting, and algorithm analysis' UNION ALL
  SELECT 'Computer Science', 'Operating Systems', 'Processes, memory, synchronization, and files' UNION ALL
  SELECT 'Languages', 'Japanese', 'Japanese reading, writing, and conversation' UNION ALL
  SELECT 'Design', 'UI/UX', 'Interface design, usability, and prototyping'
) v ON v.subject_name = s.name
ON DUPLICATE KEY UPDATE description = VALUES(description);


-- Suggested application/service-layer invariants:
-- 1) A group owner must also have an OWNER/ACTIVE group_memberships row.
-- 2) For conversation_type='DIRECT', direct_conversation_pairs must exist and the conversation must have exactly 2 members.
-- 3) For conversation_type='GROUP', conversation_members should be synchronized with active group_memberships.
-- 4) Only active group members may read/post in the group's conversation, attend private sessions, or access private resources.
-- 5) A message sender must be an active participant in that conversation; block rules should be checked before starting/sending DMs.
-- 6) Enforce moderator permissions, group capacity, invite expiry, and report target consistency in a transaction or trigger.
-- 7) Add a full-text/search index (or external search service) for study_groups.name/descriptions, subjects and topics as scale grows.
