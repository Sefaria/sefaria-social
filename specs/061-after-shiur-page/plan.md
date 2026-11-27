# Approach

Expand the presentation to the agreed after-class artifact taxonomy. ClassWorkspace renders real source excerpts through the existing SourceText renderer, selected from recorded refs, alongside an explicit empty shared-margin pane. RecordingArtifacts owns section navigation and the visual itinerary. Overview, chiddushim, open questions and next-learning sections use honest empty states because no persistence contract for those assets exists in this checkout. Preserve all existing replay, failure and permission behavior.

Extend RecordingPage with a separate RecordingArtifacts component using the existing ReplayApi manifest/transcript reads. Keep loading and failures independent of metadata. Poll only while assets are pending; cancel on unmount/recording change. Use existing transcriptLines and ReaderRefLink, SourceText and theme tokens. Existing player is opened paused, then sought and played by RecordingPage. No host or server contract changes.

RecordingController.stop returns the successfully finalized id (void otherwise). closeSession checks finalization and navigates after sending room close, retaining the existing failure state if upload failed. Tests fake only host/media APIs, not a database. The product makes no database writes beyond existing finalization.

A recording fixture for local review will be seeded outside tracked product code and identified as a test recording, using existing database tables and asset files; it must never be packaged as production page content.
