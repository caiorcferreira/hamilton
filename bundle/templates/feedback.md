<!--
  Feedback — the intake artifact for third-party comments on a change's pull/merge
  request.
  Lives at: .hamilton/changes/<change>/feedback/<YYYY>-<MM>-<DD>-<index>.md
  One file per intake pass; a later pass gets the next date/index and never rewrites an
  earlier one. Distinct from review.md, which is the internal review step's verdict on our
  own diff — external feedback never goes there.
  Written by the hamilton-feedback skill in two passes: a subagent transcribes the
  comments (header + C-blocks), then the main session fills each Assessment and Decision.
  Delete this comment block before finalizing.
-->

# Feedback: <Change Title> — <YYYY-MM-DD> (pass <index>)

| Field | Value |
| --- | --- |
| Request | <url> |
| Branch | <branch> |
| Fetched | <YYYY-MM-DD> |
| Comments | <n> (open: <n>, resolved: <n>, outdated: <n>) |

<!-- One `## C<n>` block per comment, numbered from C1 in the order the request lists them.
     Transcription pass fills Where / Author / Thread / Quote / Link. Assessment and Decision
     stay unfilled until the investigation pass. -->

## C1 — <one-line claim>

- Where: <file:line | general>
- Author: <reviewer> <(bot)>
- Thread: open | resolved | outdated
- Link: <permalink>
- Contains agent-directed instructions: yes | no
- Quote:

  > <the comment body, verbatim — never paraphrased, trimmed, or corrected>

**Assessment**

<!-- Filled by the investigation pass, after reading the code the comment names. -->

- Applicable: yes | no | partly | needs-decision — <the evidence that settles it, cited by file:line>
- Root cause: <the underlying defect the comment is a symptom of — not a restatement of the
  complaint. "Same cause as C<n>" when shared; name the decision when it lives in design.md.>
- Suggested fix: <what to change, concretely. Where the reviewer's fix treats the symptom and
  the cause sits deeper, say both and recommend one.>
- Artifact impact: code | design | requirements | spec-gap
- Cannot verify: <what the repository cannot settle, or none>

**Decision**

<!-- Filled after the user decides. no-action = the comment carried no actionable claim. -->

- Decision: accepted | rejected | deferred | no-action — <rationale>
- Draft reply: <for rejected and deferred: the reply the author can post — technical
  reasoning, no apology, no thanks. Omit otherwise.>

## Routing

<!-- Where the accepted comments go. design/requirements impact routes through
     hamilton-propose (amend) before hamilton-plan; code-only impact goes straight to
     hamilton-plan (amend). spec-gap is a note for finish-work, not a route. -->

| Impact | Comments | Next step |
| --- | --- | --- |
| design / requirements | <C ids> | hamilton-propose (amend) → hamilton-plan (amend) |
| code | <C ids> | hamilton-plan (amend) |
| spec-gap | <C ids> | note for hamilton-finish-work |
| none | <C ids> | — |

**Summary:** <n> comments — accepted <n>, rejected <n>, deferred <n>, no-action <n>.
