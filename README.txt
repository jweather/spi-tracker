Jeremy Weatherford
jweather@xidus.net

This is an experiment that escaped from the lab, and has not been prettied up
for public consumption.  I apologize in advance for the horrors you're about
to witness.

Sonic Pi listens for OSC on UDP localhost:4557.  One of the supported OSC messages 
is /run-code, which evaluates Ruby code in the context of the current workspace.
The provided Sonic Pi code (tracker.spi) has a number of methods that are
intended to be called in this way, such as "setXY" to set/clear a note in a matrix.

The node.js server listens for feedback from Sonic Pi on UDP 7000.  Sonic Pi reports
back with the current beat and pattern index, which is used to highlight the current
time on the iPad interface.

The node.js server also deals with touchOSC connections from the iPads on UDP 8000,
handling button pushes and sending feedback out.  The tracker.touchosc project is
designed with the correct control names to interface with this.