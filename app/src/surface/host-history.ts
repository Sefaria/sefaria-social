// The host-bridged history for the surface router (plan R4): getLocation reads host.location.get(), push and replace call
// host.navigate, and it notifies on host.location.subscribe. This is the only file allowed to name the browser history and
// location APIs (R1; test/architecture enforces it). Spike S1 writes it.
export {};
