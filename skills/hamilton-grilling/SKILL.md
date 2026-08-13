---
name: hamilton-grilling
description: "Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases."
---

Interview me relentlessly about every aspect of this until we reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.

If a *fact* can be found by exploring the environment (filesystem, tools, etc.), look it up rather than asking me. The *decisions*, though, are mine — put each one to me and wait for my answer.

Do not act on it until I confirm we have reached a shared understanding.

If the user reverses an earlier recorded decision, update the artifact that records it to state the current truth — never leave the stale version standing.

## Process flow

```dot
digraph hamilton_grilling {
    "Identify plan / decision to stress-test" [shape=box];
    "Pick next question\n(one at a time)" [shape=box];
    "Fact or decision?" [shape=diamond];
    "Look it up in the environment" [shape=box];
    "Put to user with recommendation\n(wait for answer)" [shape=box];
    "Shared understanding?" [shape=diamond];
    "Stop — await confirmation\n(do not act yet)" [shape=doublecircle];

    "Identify plan / decision to stress-test" -> "Pick next question\n(one at a time)";
    "Pick next question\n(one at a time)" -> "Fact or decision?";
    "Fact or decision?" -> "Look it up in the environment" [label="fact"];
    "Fact or decision?" -> "Put to user with recommendation\n(wait for answer)" [label="decision"];
    "Look it up in the environment" -> "Shared understanding?";
    "Put to user with recommendation\n(wait for answer)" -> "Shared understanding?";
    "Shared understanding?" -> "Pick next question\n(one at a time)" [label="no"];
    "Shared understanding?" -> "Stop — await confirmation\n(do not act yet)" [label="yes"];
}
```
