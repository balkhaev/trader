# Add PredictionVector Repository for prediction tracking

## Overview

Create PredictionVectorRepository to manage agent prediction vectors with analytics capabilities for measuring prediction accuracy over time.

## Rationale

PredictionVector schema exists with rich tracking fields (status, confidence, accuracy, checkCount) but no repository. Agent performance analysis requires querying vectors by agent, status, timeframe. The pattern in insight.repository shows how to build accuracy tracking methods.

---
*This spec was created from ideation and is pending detailed specification.*
