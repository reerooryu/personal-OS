// ASCEND → Apple Calendar.
//
// Reads a JSON plan on stdin and makes the calendar named in it (normally
// "ASCEND", created in iCloud so it reaches the iPhone) match the plan within
// the plan's time window. Only events this tool created (marked with an
// ascend:// URL) are ever changed or removed. Prints one JSON line.
//
// Built by scripts/package-app.mjs with: swiftc -O calendar-sync.swift -o ascend-calendar

import EventKit
import Foundation

struct Item: Decodable {
    let uid: String
    let title: String
    let location: String?
    let notes: String
    let start: Double
    let end: Double
    /// All-day events: EventKit takes the day's start and treats the end as inclusive.
    let allDay: Bool?
}

struct Plan: Decodable {
    let calendarName: String
    let from: Double
    let to: Double
    let items: [Item]
}

func finish(_ result: [String: Any]) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: result), let s = String(data: data, encoding: .utf8) {
        print(s)
    }
    exit(0)
}

func fail(_ message: String) -> Never {
    finish(["ok": false, "error": message, "added": 0, "updated": 0, "removed": 0])
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let plan = try? JSONDecoder().decode(Plan.self, from: input) else { fail("Bad input from ASCEND") }

let store = EKEventStore()

// Ask for access, keeping the run loop alive so the system prompt can appear.
var answered = false
var granted = false
var accessError: String? = nil
let completion: (Bool, Error?) -> Void = { ok, err in
    granted = ok
    accessError = err?.localizedDescription
    answered = true
}
if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents(completion: completion)
} else {
    store.requestAccess(to: .event, completion: completion)
}
let deadline = Date().addingTimeInterval(120)
while !answered && Date() < deadline {
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
}
if !answered { fail("No answer to the Calendar permission request") }
if !granted {
    fail(accessError ?? "Calendar access is off. Turn it on in System Settings → Privacy & Security → Calendars → ASCEND.")
}

// Find or create the calendar. Prefer iCloud so it syncs to the iPhone.
func findCalendar() -> EKCalendar? {
    store.calendars(for: .event).first { $0.title == plan.calendarName && $0.allowsContentModifications }
}

var calendar = findCalendar()
if calendar == nil {
    let cal = EKCalendar(for: .event, eventStore: store)
    cal.title = plan.calendarName
    let sources = store.sources
    let icloud = sources.first { $0.sourceType == .calDAV && $0.title.lowercased().contains("icloud") }
    let fallback = store.defaultCalendarForNewEvents?.source ?? sources.first { $0.sourceType == .local }
    guard let source = icloud ?? fallback else { fail("No calendar account found on this Mac") }
    cal.source = source
    do {
        try store.saveCalendar(cal, commit: true)
    } catch {
        fail("Couldn't create the \(plan.calendarName) calendar: \(error.localizedDescription)")
    }
    calendar = cal
}
guard let target = calendar else { fail("Calendar not available") }

// Each event carries ascend://event/<escaped id>. Escaping everything but
// letters and digits keeps ids like "tt:mon-w1-0750-english:2026-11-16" from
// being read as a host and port.
let marker = "ascend://event/"
func keyOf(_ uid: String) -> String {
    uid.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? uid
}
let from = Date(timeIntervalSince1970: plan.from / 1000)
let to = Date(timeIntervalSince1970: plan.to / 1000)
let predicate = store.predicateForEvents(withStart: from, end: to, calendars: [target])

var existing: [String: EKEvent] = [:]
for e in store.events(matching: predicate) {
    guard let u = e.url?.absoluteString, u.hasPrefix(marker) else { continue }
    let uid = String(u.dropFirst(marker.count))
    if existing[uid] != nil {
        // A duplicate left behind by an interrupted run: remove it.
        try? store.remove(e, span: .thisEvent, commit: false)
    } else {
        existing[uid] = e
    }
}

let zone = TimeZone(identifier: "Asia/Bangkok")
var added = 0
var updated = 0
var removed = 0
var wanted = Set<String>()


do {
    for item in plan.items {
        let key = keyOf(item.uid)
        wanted.insert(key)
        let allDay = item.allDay ?? false
        let start = Date(timeIntervalSince1970: item.start / 1000)
        // An all-day event's end is the same day: the next midnight would make it two days.
        let end = allDay ? start : Date(timeIntervalSince1970: item.end / 1000)
        if let e = existing[key] {
            let timesDiffer = allDay ? (!e.isAllDay || e.startDate != start) : (e.isAllDay || e.startDate != start || e.endDate != end)
            if e.title != item.title || (e.location ?? "") != (item.location ?? "") || (e.notes ?? "") != item.notes || timesDiffer {
                e.title = item.title
                e.location = item.location
                e.notes = item.notes
                e.isAllDay = allDay
                e.startDate = start
                e.endDate = end
                e.timeZone = allDay ? nil : zone
                try store.save(e, span: .thisEvent, commit: false)
                updated += 1
            }
        } else {
            let e = EKEvent(eventStore: store)
            e.calendar = target
            e.title = item.title
            e.location = item.location
            e.notes = item.notes
            e.isAllDay = allDay
            e.startDate = start
            e.endDate = end
            e.timeZone = allDay ? nil : zone
            guard let url = URL(string: marker + key) else { fail("Couldn't mark event \(item.uid)") }
            e.url = url
            try store.save(e, span: .thisEvent, commit: false)
            added += 1
        }
    }
    for (key, e) in existing where !wanted.contains(key) {
        try store.remove(e, span: .thisEvent, commit: false)
        removed += 1
    }
    try store.commit()
} catch {
    store.reset()
    fail("Apple Calendar refused a change: \(error.localizedDescription)")
}

finish(["ok": true, "error": NSNull(), "added": added, "updated": updated, "removed": removed, "calendar": target.title])
