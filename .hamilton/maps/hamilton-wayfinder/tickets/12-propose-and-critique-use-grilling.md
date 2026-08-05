# Update propose and critique to use hamilton-grilling

Type: task
Status: open
Blocked by: 07

## Question

Update `hamilton-propose` and `hamilton-critique` to delegate their one-question-at-a-time dialogue to `hamilton-grilling` instead of embedding the pattern inline.

[Which siblings to port, and their Hamilton shape](07-which-siblings-to-port.md) decided to port grilling as a general-purpose dialogue primitive (`hamilton-grilling`), and to have propose and critique use it. This ticket executes that refactor.

Settle:

- What changes in propose's entrypoint and flow when it reaches for grilling instead of conducting dialogue itself?
- Same for critique.
- Are there any propose/critique-specific dialogue behaviors that don't fit grilling's generic pattern?
- Test coverage updates needed once the refactor lands.

