# Module 06 — CONTEXT: Documentation That Gets Read

## 1. The New Hire Test

Based on my recent project work, I cannot confidently say that every project's README would allow a completely new engineer to set up and run the application without help.

A README may explain the technology stack and installation commands, but a new engineer also needs accurate environment variable names, database configuration, migration and seed instructions, external service setup, and clear steps to start both the frontend and backend.

For example, in a full-stack project, knowing that it uses React, Node.js, and PostgreSQL is not enough. The developer should know how to configure the database, provide required environment variables, install dependencies, run migrations, and verify that the application is working.

My goal should be to make setup documentation independent of the original developer's availability.

## 2. Verification Cadence

I have worked on documentation and setup instructions, but I cannot claim that I have systematically tested every README end-to-end on a clean machine recently.

I think teams should treat documentation as verified code by introducing a few practices:

1. **Clean setup testing:** Regularly clone the repository into a fresh environment and follow the README exactly.
2. **Automated validation:** Use CI workflows to verify installation commands, environment configuration, builds, and basic startup checks.
3. **Environment consistency:** Maintain an `.env.example` file and validate required environment variables so documentation and application configuration remain aligned.
4. **Documentation ownership:** Assign owners to important setup guides and runbooks.
5. **Update with code changes:** When a deployment process, environment key, database, or command changes, update the corresponding documentation in the same pull request.

## Final Reflection

Documentation should not be considered correct just because someone wrote it. It should be considered reliable only after someone has followed its instructions and verified that they work. A good README should help a new engineer become productive without depending on another engineer being available.
