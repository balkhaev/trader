# Split large executor.service.ts into focused modules

## Overview

The agent executor.service.ts file has grown to 987 lines, handling multiple concerns: agent lifecycle management, context building, risk checking, LLM trade decisions, trade execution, subscriber processing, copy trading, and prediction vector creation.

## Rationale

Large files with multiple responsibilities are harder to test, maintain, and understand. This file handles at least 7 distinct concerns that should be separate modules.

---
*This spec was created from ideation and is pending detailed specification.*
