# Module 01 — Step 1: CONTEXT
**Topic:** Containerization Fundamentals & "Works on My Machine" Syndrome

## Learner Reflections & Micro-Exercise Responses

### 1. What could go wrong if you zip your project folder and send it to a colleague?
> If I zip my project folder and share it with someone, they may not be able to run it because their system might have different Node.js versions, missing dependencies, native libraries, environment variables, or configurations. So, the application may behave differently on their machine.

### 2. Difference between "installing the same OS" and "running the same container"
> Installing the same OS does not guarantee that both systems have identical runtimes, dependencies, and configurations. A container packages the application with its required runtime and dependencies, providing a consistent and isolated environment across different machines.

## Key Architectural Insights
- **Immutable Artifact:** Containers lock the runtime, OS-level dependencies, and binaries into an immutable image layer stack, preventing runtime drift between development, staging, and production.
- **Kernel Sharing vs. VM:** Containers share the host OS kernel while providing isolated namespaces (PID, NET, MNT, IPC, UTS) and cgroups (resource limits), starting in milliseconds with minimal overhead compared to heavy full-OS virtual machines.
