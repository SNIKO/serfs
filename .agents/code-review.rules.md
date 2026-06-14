# Areas to focus on

- **Goal Fit**: Check whether the change solves the requested problem without adding speculative behavior.
- **Verification**: Confirm the author defined success criteria and ran relevant tests or commands.
- **Surgical Scope**: Flag unrelated refactors, formatting churn, or cleanup outside the task.
- **Code Quality**: Ensure that the code adheres to best practices, is well-structured, and is easy to read and maintain.
- **Simplicity**: Look for opportunities to simplify complex code, remove unnecessary abstractions, and improve readability.
- **Usability**: The library should be easy to use by developers, without too much boilerplate or configuration.
- **Edge Cases**: Ignore rare edge cases that require boilerplate or complex code to handle, unless they are critical to the library's functionality.
- **Clarity of Assumptions**: Flag hidden assumptions when different interpretations would lead to different code.

# Areas to skip

- Security
- Performance
- `/scripts` - scripts for local testing