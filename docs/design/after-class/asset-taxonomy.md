# After-class experience: implementation and design reference

Two complementary deliverables preserve the product direction while shipping useful behavior on the existing architecture.

## 1. Working feature PR

Branch: `feature/after-shiur-page`. Existing destination: `/social/rec/:recordingId`.

The finish-and-save flow lands on this page. Existing room recording lists and recording cards lead to the same destination; back links return to the room and Social. Existing public-by-link recording policy remains unchanged.

Implemented locally: recording actions; visual chronological itinerary with repeated visits; distinct-source bibliography; bilingual source excerpts with selection and links to the full reader; searchable timestamped transcript when available; explicit processing, missing and failure states. The reading workspace includes an empty margin pane. Further synthesis categories are grouped in a disclosure, with accurate empty states.

Available data contracts inspected: recording metadata, manifest chapters, reader timeline, media, and transcript. No saved class annotation, summary, discovery, question or next-learning contract was found in this checkout's database schema or asset API. Those sections do not imply generation or persistence exists.

## 2. Interactive design reference

See the [interactive reference and preview instructions](README.md#open-the-interactive-reference).

The Peleimu example illustrates the intended full experience. Text references follow the prepared source selection. Participants, discussion, highlights and synthesis are illustrative. They must not be migrated as production class records. This reference is a design deliverable, separately labeled from the functioning feature.

| Artifact                 | Purpose and presentation                                                              | What production needs                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Recording                | Revisit the class, seek by moment                                                     | Existing recording/media and replay                                                                                           |
| Transcript               | Search the conversation and jump into playback                                        | Existing timestamped transcript plus configured transcription service                                                         |
| Text itinerary           | See where the group went, including returns                                           | Existing chapters; later grouping into meaningful discussion segments                                                         |
| Bibliography             | Reopen each distinct learned source                                                   | Existing canonical refs and reader links                                                                                      |
| Shared annotated reading | Actual source text with anchored highlights, participant ideas and threads in margins | Persisted source/version/segment anchors, contributors, annotation bodies, thread structure, visibility and class association |
| Class summary            | Understand what was explored                                                          | Saved class summary with provenance and review/update behavior                                                                |
| Chiddushim               | Preserve discoveries and connections                                                  | Saved insights linked to source passages and supporting class moments; attribution                                            |
| Open questions           | Preserve unfinished inquiry                                                           | Saved questions with source/context links and answer status                                                                   |
| Next learning            | Continue an inquiry after the class                                                   | Saved follow-up prompts and reader references                                                                                 |

The annotation artifact is a shared reading document containing the text and ideas together, not a list of comments detached from sources. Its design reference includes participant filters, anchored contributions and a captured collaboration timeline. Production collaboration and authorship must be designed against real stored events.

## Shipping boundary

Review the functional feature PR and the interactive reference together. Merge working behavior after acceptance and repository approval. Use the taxonomy as the design contract for subsequent storage, collaboration and generation work. Group calendars, recurring registration, profiles showing led/attended shiurim and broader asset discovery are related journeys beyond this recording-page PR.
