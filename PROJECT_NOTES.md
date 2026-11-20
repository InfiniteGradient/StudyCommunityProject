StudySphere - Project Notes
Overview
StudySphere is a learning-community platform where users can discover study groups by subject, topic, and proficiency level. Members can collaborate through study sessions, shared tasks, learning resources, group chats, and direct messages.

The application distinguishes a user's academic year from their proficiency in a subject. For example, a second-year student may be a beginner in machine learning.
Technology stack
- Backend: Node.js and Express
- Database: MySQL or MariaDB
- Database access: mysql2
- Authentication: bcryptjs for password hashing and JSON Web Tokens (JWT)
- Frontend: HTML, CSS, and browser-side JavaScript
- Local database environment: XAMPP can be used to run MySQL or MariaDB
Project structure
- server.js - Express server, API routes, authentication, authorization, and database operations.
- database/schema.sql - Database creation script, table definitions, constraints, indexes, and initial reference data.
- database/seed_demo_data.sql - Sample data for local testing.
- database/verify_demo_data.sql - Queries for checking the sample data.
- public/index.html - Frontend page structure.
- public/styles.css - Frontend styling.
- public/app.js - Frontend interactions and API requests.
- .env.example - Example local configuration. Copy this file to .env and enter your own local settings.
- package.json - Project scripts and dependencies.
The database schema currently defines 32 tables covering users and profiles, subjects and topics, study groups and memberships, sessions, resources, tasks, conversations, messages, moderation, and notifications. Refer to database/schema.sql for the exact table definitions and relationships.
Main functionality
- User registration, sign-in, and profile access.
- Study-group discovery with search and filters.
- Public group joining and private-group requests or invitations.
- Group membership and moderation controls.
- Group conversations and direct messaging.
- Sharing learning resources.
- Creating study tasks and assigning them to members.
- Scheduling study sessions and managing attendance.
- Notifications, user blocking, and reporting.
Local setup
1. Install Node.js 20 or later and start MySQL/MariaDB (for example, through XAMPP).
2. Create a local .env file by copying .env.example.
3. Set the database connection values to match your local database configuration. Set JWT_SECRET to a unique random value of at least 32 characters.
4. Import database/schema.sql using phpMyAdmin or the MySQL command-line client. The script creates the study_community database and inserts initial reference data.
5. Open a terminal in the project directory and install dependencies:
   npm install
6. Start the application:
   npm start
7. Open http://localhost:3000. Check http://localhost:3000/api/health to verify the backend and database connection.
Security notes
- Passwords are stored as bcrypt hashes, not plaintext.
- JWT signing uses a secret loaded from the environment. Do not use the example value in a deployed environment.
- Database queries that use user-supplied values use parameterized statements.
- Protected routes check authentication and the relevant membership or permissions.
- The application uses request limits and rate limiting on authentication and API routes.
- Keep .env out of version control. Commit .env.example, but never commit real passwords, tokens, API keys, or other credentials.
- Do not use a MySQL administrator account for a deployed application. Use a database account with only the permissions the application needs.
Current limitations
- This is a local MVP, not a production-ready hosted service.
- Chat updates use request/refresh-based loading rather than real-time WebSocket delivery.
- File attachment support currently stores metadata; production file storage needs a secure storage service.
- Some database structures support future functionality that may not yet have a complete frontend workflow.
- Before public deployment, add and test production-grade HTTPS, session/cookie protections, CSRF protection where applicable, email verification, password recovery, monitoring, backups, and automated tests.
- Update CORS_ORIGIN to the exact frontend origins used by a deployment.