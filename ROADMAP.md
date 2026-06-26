# Hamilton roadmap 

This document contains brainstorms, ideais and proposals for the project next steps.

## Implement long-term memory

Create a learning pipeline that store historical decisions, changes, preferences and facts about each project. Must support forgetting. 

Use a database (SQLite/PGLite) instead of markdown files.

## Improve guidelines

Implement a real RAG pipeline for guidelines. Maybe merge with long-term memory.

## Packages infraestrutura

Design an extension system based on packages. Each package may have agents, workflows, variants, skills, hooks and extensions.

The developement package would have workflows like `feature-dev`, a hook for nudging the agent to write it's progress if it failed to do so.