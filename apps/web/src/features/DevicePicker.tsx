import { useEffect, useState } from 'react'
import { KindMark } from '../components/icons'
import { captureKind, useDevice, type DeviceChoice, type DeviceKind } from '../state/device'

const nameOf = (d: MediaDeviceInfo, index: number) =>
  d.label || `${d.kind === 'videoinput' ? 'Camera' : 'Microphone'} ${index + 1}`

// Chrome also lists "default" and "communications" aliases of the same hardware.
const inputs = (all: MediaDeviceInfo[]) =>
  all.filter((d) => (d.kind === 'audioinput' || d.kind === 'videoinput') && d.deviceId !== 'default' && d.deviceId !== 'communications')

export function DevicePicker() {
  const choice = useDevice((s) => s.choice)
  const open = useDevice((s) => s.open)
  const select = useDevice((s) => s.select)
  const setOpen = useDevice((s) => s.setOpen)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [listed, setListed] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancel = false
    const load = async () => {
      const all = await navigator.mediaDevices.enumerateDevices()
      if (!cancel) {
        setDevices(inputs(all))
        setListed(true)
      }
    }
    void load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => {
      cancel = true
      navigator.mediaDevices.removeEventListener('devicechange', load)
    }
  }, [open])

  const revealNames = async () => {
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        stream = null
      }
    }
    stream?.getTracks().forEach((t) => t.stop())
    const all = await navigator.mediaDevices.enumerateDevices()
    setDevices(inputs(all))
  }

  const pick = (d: MediaDeviceInfo, index: number) => {
    const next: DeviceChoice = {
      deviceId: d.deviceId,
      kind: d.kind as DeviceKind,
      label: nameOf(d, index),
    }
    select(next)
  }

  const mics = devices.filter((d) => d.kind === 'audioinput')
  const cams = devices.filter((d) => d.kind === 'videoinput')
  const unnamed = devices.some((d) => !d.label)
  const kind = captureKind(choice)

  return (
    <div className="device-slot">
      <button
        type="button"
        className="device-chip"
        aria-expanded={open}
        aria-label={open ? 'Hide devices' : `Recording with ${choice.label}`}
        onClick={() => setOpen(!open)}
      >
        <KindMark kind={kind} />
        <span>{choice.label}</span>
      </button>
      {open && (
        <div className="device-list" role="listbox" aria-label="Recording device">
          <DeviceGroup title="Microphones" devices={mics} choice={choice} onPick={pick} />
          <DeviceGroup title="Cameras" devices={cams} choice={choice} onPick={pick} />
          {unnamed && (
            <button type="button" className="device-name" onClick={() => void revealNames()}>
              Name devices
            </button>
          )}
          {listed && devices.length === 0 && <p className="device-empty">No devices found</p>}
        </div>
      )}
    </div>
  )
}

function DeviceGroup({
  title,
  devices,
  choice,
  onPick,
}: {
  title: string
  devices: MediaDeviceInfo[]
  choice: DeviceChoice
  onPick: (d: MediaDeviceInfo, index: number) => void
}) {
  if (!devices.length) return null
  return (
    <div className="device-group">
      <p className="device-group-title">{title}</p>
      {devices.map((d, i) => {
        const label = nameOf(d, i)
        const current = d.deviceId === choice.deviceId && d.kind === choice.kind
        return (
          <button key={d.deviceId || label} type="button" aria-current={current ? 'true' : undefined} onClick={() => onPick(d, i)}>
            {label}
          </button>
        )
      })}
    </div>
  )
}
