# Keeps Windows from going to sleep while the batch runner is alive. Started by run-batches.sh with
# the runner's Windows process id; exits on its own when the runner does. It does not stop sleep
# from a closed lid or the power button.
param([int]$Watch)

$sig = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
$api = Add-Type -MemberDefinition $sig -Name Power -Namespace KeepAwake -PassThru
while (Get-Process -Id $Watch -ErrorAction SilentlyContinue) {
  [void]$api::SetThreadExecutionState(0x00000001) # ES_SYSTEM_REQUIRED: reset the idle-sleep timer
  Start-Sleep -Seconds 30
}
