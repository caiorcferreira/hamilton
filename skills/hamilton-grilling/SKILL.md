---
name: hamilton-grilling
description: "Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases."
---

Interview me relentlessly about every aspect of this until we reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.

If a *fact* can be found by exploring the environment (filesystem, tools, etc.), look it up rather than asking me. The *decisions*, though, are mine — put each one to me and wait for my answer.

Do not act on it until I confirm we have reached a shared understanding.

If the user reverses an earlier recorded decision, update the artifact that records it to state the current truth — never leave the stale version standing.

## Challenge posture

Evaluate every answer the user gives before moving on. If it has a concrete weakness — a failure scenario, a cost, a contradiction with a prior decision or the glossary — push back **once**, stating the objection specifically. If the user reaffirms, or marks the decision final, accept it: record their decision as the authoritative answer, note any reservation in one line, and drop the point for the rest of the session. The user owns decisions; you own making sure they were made with eyes open.

## Invocation contract

Other skills invoke grilling with two inputs: the **content** to grill (a plan, findings, approaches, open questions) and an **exit condition** (e.g. "intent is clear", "an approach is chosen", "every finding is validated"). Grill until the exit condition holds, record the answers where the caller directs (a ticket's `## Answer`, the artifact under revision), and return control. Invoked bare — with no content or exit condition — ask what to stress-test and grill until shared understanding.

## Process flow

```dot
digraph hamilton_grilling {
    "Identify content + exit condition" [shape=box];
    "Pick next question\n(one at a time)" [shape=box];
    "Fact or decision?" [shape=diamond];
    "Look it up in the environment" [shape=box];
    "Put to user with recommendation\n(wait for answer)" [shape=box];
    "Concrete weakness?" [shape=diamond];
    "Push back once\n(specific objection)" [shape=box];
    "Accept + record answer\n(note reservation in one line)" [shape=box];
    "Exit condition met?" [shape=diamond];
    "Stop — await confirmation\n(do not act yet)" [shape=doublecircle];

    "Identify content + exit condition" -> "Pick next question\n(one at a time)";
    "Pick next question\n(one at a time)" -> "Fact or decision?";
    "Fact or decision?" -> "Look it up in the environment" [label="fact"];
    "Fact or decision?" -> "Put to user with recommendation\n(wait for answer)" [label="decision"];
    "Look it up in the environment" -> "Exit condition met?";
    "Put to user with recommendation\n(wait for answer)" -> "Concrete weakness?";
    "Concrete weakness?" -> "Push back once\n(specific objection)" [label="yes"];
    "Concrete weakness?" -> "Accept + record answer\n(note reservation in one line)" [label="no"];
    "Push back once\n(specific objection)" -> "Accept + record answer\n(note reservation in one line)" [label="user reaffirms or revises"];
    "Accept + record answer\n(note reservation in one line)" -> "Exit condition met?";
    "Exit condition met?" -> "Pick next question\n(one at a time)" [label="no"];
    "Exit condition met?" -> "Stop — await confirmation\n(do not act yet)" [label="yes"];
}
```
