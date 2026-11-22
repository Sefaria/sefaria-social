# Plan: 004 session state machine

`app/src/features/session/machine.ts`: the `SessionView` union from plan 4.3, a `SessionEvent` union, the `TRANSITIONS` table
(one step function per allowed state/event pair; a guard may refuse with a reason) and `transition()`. The test builds one
representative state per kind and one event per type and checks all 72 pairs: the 17 allowed ones reach the expected state, the
55 others are refused with the state unchanged.
