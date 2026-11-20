StudySphere — Study Community Platform
StudySphere is a web application for students to discover study groups, collaborate with other learners, and communicate through group and direct chats.
Features
- Discover study groups by subject, topic, and learning level.
- Create public and private study groups.
- Join public groups or request access to private groups.
- Manage group membership and roles.
- Share learning resources, tasks, and study sessions.
- Use group chats and direct messages.
- Access basic reporting, moderation, and notifications features.
Technology
- Frontend: HTML, CSS, and JavaScript
- Backend: Node.js and Express
- Database: MySQL or MariaDB
- Local database environment: XAMPP and phpMyAdmin
Project structure
StudyCommunityProject/
├── database/
│   ├── schema.sql
│   ├── seed_demo_data.sql
│   └── verify_demo_data.sql
├── docs/
│   ├── INSTALL_QUICKSTART.txt
│   └── TESTING_CHECKLIST.md
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── PROJECT_NOTES.md
├── server.js
└── start.bat
Requirements
- Node.js 20 or later
- npm (included with Node.js)
- XAMPP with MySQL or MariaDB
Run locally on Windows
1. Extract the project to a folder on your computer.
2. Open XAMPP and start MySQL. Start Apache only if you want to use phpMyAdmin.
3. Open http://localhost/phpmyadmin and import database/schema.sql. The script creates the study_community database and its tables.
4. To add sample records for local testing, select the study_community database in phpMyAdmin and import database/seed_demo_data.sql. This step is optional.
5. Copy .env.example to a new file named .env in the project root. Update the database settings to match your local MySQL setup and replace the example JWT_SECRET with a private random value of at least 32 characters.
   In PowerShell, you can create the file with:
   Copy-Item .env.example .env
6. Open PowerShell or Command Prompt in the project folder and install the dependencies:
   npm install
7. Start the application:
   npm start
8. Open http://localhost:3000 in your browser.
The API health endpoint is http://localhost:3000/api/health. A successful response should report ok: true and database: connected.
Testing
Use docs/TESTING_CHECKLIST.md for the manual feature and database checks. The optional database/verify_demo_data.sql script contains read-only checks for the sample records.

The seed script creates demonstration accounts and sample records. Use these only in a local test environment; do not use the sample accounts or passwords on a public server, and do not load demo data into a production database.
Configuration and security
- Keep .env on your own computer. Do not commit or upload it to GitHub.
- Commit .env.example only when it contains placeholder values, not real credentials or secrets.
- Use a unique, randomly generated JWT_SECRET for your local environment. Never use the example placeholder in a deployed environment.
- Do not put real user data, passwords, API keys, or database credentials in source files or sample SQL data.
- For any deployment, use HTTPS, a least-privilege database account, secure secret management, backups, and appropriate monitoring.
Current limitations
This project is an academic MVP intended for local development and testing, not a production-ready service. Email delivery and real-time push messaging are not configured; chat messages are retrieved through HTTP requests. Message attachment records contain metadata only—binary files are not stored by the application. Additional deployment hardening, automated tests, monitoring, and backup/restore procedures are needed before public use.