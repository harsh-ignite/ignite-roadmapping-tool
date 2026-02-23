import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import './App.css'
import { FieldError, FieldLabel } from '@/components/ui/field'

const STORAGE_KEY = 'roadmap-tool-state-v1'
const WORK_DAYS_PER_WEEK = 5
const MIN_WEEKS_ON_BOARD = 6
const ROW_HEIGHT = 74

type ResourceKey = 'backend' | 'frontend' | 'designers' | 'qa'

type ResourceSet = Record<ResourceKey, number>

type Lane = {
  id: string
  name: string
}

type Milestone = {
  id: string
  name: string
  day: number
}

type Task = {
  id: string
  name: string
  laneId: string
  startDay: number
  duration: number
  resources: ResourceSet
}

type Roadmap = {
  id: string
  name: string
  startDate: string
  endDate: string
  capacity: ResourceSet
  lanes: Lane[]
  tasks: Task[]
  milestones: Milestone[]
}

type RoadmapDraft = {
  name: string
  startDate: string
  endDate: string
  capacity: ResourceSet
}

type TaskDraft = {
  name: string
  laneId: string
  duration: number
  resources: ResourceSet
  startDay?: number
}

type MilestoneDraft = {
  name: string
  day: number
}

type DeleteIntent =
  | {
      kind: 'task'
      taskId: string
      taskName: string
    }
  | {
      kind: 'lane'
      laneId: string
      laneName: string
      taskCount: number
    }
  | {
      kind: 'roadmap'
      roadmapId: string
      roadmapName: string
    }
  | {
      kind: 'milestone'
      milestoneId: string
      milestoneName: string
    }

type Notice = {
  message: string
  variant: 'default' | 'destructive'
}

type RoadmapFormErrors = {
  name?: string
  startDate?: string
  endDate?: string
}

type TaskFormErrors = {
  name?: string
  laneId?: string
  duration?: string
  startDay?: string
}

type MilestoneFormErrors = {
  name?: string
  day?: string
}

type LaneFormErrors = {
  name?: string
}

const RESOURCE_FIELDS: { key: ResourceKey; label: string; short: string }[] = [
  { key: 'backend', label: 'Backend devs', short: 'BE' },
  { key: 'frontend', label: 'Frontend devs', short: 'FE' },
  { key: 'designers', label: 'Designers', short: 'DS' },
  { key: 'qa', label: 'QA engineers', short: 'QA' },
]

const createEmptyResources = (): ResourceSet => ({
  backend: 0,
  frontend: 0,
  designers: 0,
  qa: 0,
})

const createDefaultLanes = (): Lane[] => []

const getDefaultStartDate = (): string => {
  const today = new Date()
  return today.toISOString().split('T')[0]
}

const getDefaultEndDate = (): string => {
  const today = new Date()
  const threeMonthsLater = new Date(today)
  threeMonthsLater.setMonth(today.getMonth() + 3)
  return threeMonthsLater.toISOString().split('T')[0]
}

const createRoadmapDraft = (): RoadmapDraft => ({
  name: '',
  startDate: getDefaultStartDate(),
  endDate: getDefaultEndDate(),
  capacity: {
    backend: 2,
    frontend: 2,
    designers: 1,
    qa: 1,
  },
})

const countWorkDaysBetween = (startDate: string, endDate: string): number => {
  const start = new Date(startDate)
  const end = new Date(endDate)
  let count = 0
  const current = new Date(start)

  while (current <= end) {
    const dayOfWeek = current.getDay()
    // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++
    }
    current.setDate(current.getDate() + 1)
  }

  return count
}

const boardDayToDate = (roadmapStartDate: string, boardDay: number): Date => {
  const startDate = new Date(roadmapStartDate)
  let workDaysAdded = 0
  const current = new Date(startDate)

  while (workDaysAdded < boardDay) {
    const dayOfWeek = current.getDay()
    // Skip weekends
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workDaysAdded++
      if (workDaysAdded === boardDay) {
        return current
      }
    }
    current.setDate(current.getDate() + 1)
  }

  return current
}

const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const toPositiveInt = (value: string, fallback = 0): number => {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    return fallback
  }
  return Math.max(0, parsed)
}

const toPositiveNumber = (value: string, fallback = 0): number => {
  const parsed = Number.parseFloat(value)
  if (Number.isNaN(parsed)) {
    return fallback
  }
  return Math.max(0, parsed)
}

const formatResourceValue = (value: number): string => {
  // If it's a whole number, show without decimals
  if (Number.isInteger(value)) {
    return value.toString()
  }
  // Otherwise show with up to 2 decimal places, removing trailing zeros
  return value.toFixed(2).replace(/\.?0+$/, '')
}

const buildId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const getTaskEndDay = (task: Task) => task.startDay + task.duration - 1

const rangesOverlap = (startA: number, durationA: number, startB: number, durationB: number) => {
  const endA = startA + durationA - 1
  const endB = startB + durationB - 1
  return startA <= endB && startB <= endA
}

const computeBoardHorizon = (roadmap: Roadmap) => {
  const dateRangeDays = countWorkDaysBetween(roadmap.startDate, roadmap.endDate)
  const maxEnd = roadmap.tasks.reduce(
    (highest, task) => Math.max(highest, getTaskEndDay(task)),
    dateRangeDays,
  )
  // Use the date range as the horizon, or extend if tasks go beyond
  return Math.max(dateRangeDays, maxEnd)
}

const getCommittedForDay = (tasks: Task[], day: number, ignoreTaskId?: string): ResourceSet => {
  const committed = createEmptyResources()
  for (const task of tasks) {
    if (ignoreTaskId && task.id === ignoreTaskId) {
      continue
    }
    if (day < task.startDay || day > getTaskEndDay(task)) {
      continue
    }
    for (const field of RESOURCE_FIELDS) {
      committed[field.key] += task.resources[field.key]
    }
  }
  return committed
}

const hasLaneConflict = (
  tasks: Task[],
  laneId: string,
  startDay: number,
  duration: number,
  ignoreTaskId?: string,
) =>
  tasks.some(
    (task) =>
      task.laneId === laneId &&
      task.id !== ignoreTaskId &&
      rangesOverlap(startDay, duration, task.startDay, task.duration),
  )

const hasNonNegativeResources = (
  roadmap: Roadmap,
  startDay: number,
  duration: number,
  resources: ResourceSet,
  ignoreTaskId?: string,
) => {
  for (let day = startDay; day < startDay + duration; day += 1) {
    const committed = getCommittedForDay(roadmap.tasks, day, ignoreTaskId)
    for (const field of RESOURCE_FIELDS) {
      const remaining = roadmap.capacity[field.key] - committed[field.key] - resources[field.key]
      if (remaining < 0) {
        return false
      }
    }
  }
  return true
}

const findNextLaneFreeDay = (
  tasks: Task[],
  laneId: string,
  duration: number,
  startFrom: number,
  ignoreTaskId?: string,
) => {
  const safeStart = Math.max(1, startFrom)
  for (let day = safeStart; day < safeStart + 365; day += 1) {
    if (!hasLaneConflict(tasks, laneId, day, duration, ignoreTaskId)) {
      return day
    }
  }
  return safeStart
}

const findNextViableDay = (roadmap: Roadmap, laneId: string, duration: number, resources: ResourceSet) => {
  const searchLimit = computeBoardHorizon(roadmap) + WORK_DAYS_PER_WEEK * 10

  for (let day = 1; day <= searchLimit; day += 1) {
    if (hasLaneConflict(roadmap.tasks, laneId, day, duration)) {
      continue
    }
    if (hasNonNegativeResources(roadmap, day, duration, resources)) {
      return day
    }
  }

  return findNextLaneFreeDay(roadmap.tasks, laneId, duration, 1)
}

const dateToBoardDay = (roadmapStartDate: string, targetDate: string): number => {
  const start = new Date(roadmapStartDate)
  const target = new Date(targetDate)
  
  // Reset times to midnight for accurate day comparison
  start.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  
  if (target < start) {
    return 1 // If target is before start, return day 1
  }
  
  let workDays = 0
  const current = new Date(start)
  
  while (current <= target) {
    const dayOfWeek = current.getDay()
    // Count working days (skip weekends)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workDays++
    }
    current.setDate(current.getDate() + 1)
  }
  
  return Math.max(1, workDays)
}

const dateToISOString = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const canPlaceTaskAt = (
  roadmap: Roadmap,
  laneId: string,
  startDay: number,
  duration: number,
  resources: ResourceSet,
  ignoreTaskId?: string,
): { valid: boolean; reason?: string } => {
  // Check lane conflict
  if (hasLaneConflict(roadmap.tasks, laneId, startDay, duration, ignoreTaskId)) {
    return { valid: false, reason: 'Another task occupies this lane during this time period' }
  }
  
  // Check resource availability
  if (!hasNonNegativeResources(roadmap, startDay, duration, resources, ignoreTaskId)) {
    return { valid: false, reason: 'Insufficient resources available during this time period' }
  }
  
  return { valid: true }
}

const formatBoardDay = (day: number, roadmapStartDate?: string) => {
  const week = Math.floor((day - 1) / WORK_DAYS_PER_WEEK) + 1
  const dayOfWeek = ((day - 1) % WORK_DAYS_PER_WEEK) + 1
  
  if (roadmapStartDate) {
    const actualDate = boardDayToDate(roadmapStartDate, day)
    return `${formatDate(actualDate)} (W${week}D${dayOfWeek})`
  }
  
  return `Week ${week}, Day ${dayOfWeek}`
}

const buildMilestoneDraft = (): MilestoneDraft => ({
  name: '',
  day: 1,
})

const buildTaskDraft = (laneId = ''): TaskDraft => ({
  name: '',
  laneId,
  duration: 1,
  resources: createEmptyResources(),
})

const loadStoredState = (): { roadmaps: Roadmap[]; activeRoadmapId: string | null } => {
  const defaultState = { roadmaps: [], activeRoadmapId: null }

  if (typeof window === 'undefined') {
    return defaultState
  }

  const savedState = localStorage.getItem(STORAGE_KEY)
  if (!savedState) {
    return defaultState
  }

  try {
    const parsed: { roadmaps?: Roadmap[]; activeRoadmapId?: string | null } = JSON.parse(savedState)
    const parsedRoadmaps = Array.isArray(parsed.roadmaps) ? parsed.roadmaps : []
    
    // Migrate old roadmaps without dates or milestones
    const migratedRoadmaps = parsedRoadmaps.map((roadmap) => {
      const migrated = { ...roadmap }
      
      if (!migrated.startDate || !migrated.endDate) {
        migrated.startDate = migrated.startDate || getDefaultStartDate()
        migrated.endDate = migrated.endDate || getDefaultEndDate()
      }
      
      if (!Array.isArray(migrated.milestones)) {
        migrated.milestones = []
      }
      
      return migrated
    })
    
    const parsedActiveId =
      typeof parsed.activeRoadmapId === 'string' || parsed.activeRoadmapId === null
        ? parsed.activeRoadmapId
        : null

    if (migratedRoadmaps.length === 0) {
      return defaultState
    }

    if (parsedActiveId && migratedRoadmaps.some((roadmap) => roadmap.id === parsedActiveId)) {
      return { roadmaps: migratedRoadmaps, activeRoadmapId: parsedActiveId }
    }

    return { roadmaps: migratedRoadmaps, activeRoadmapId: migratedRoadmaps[0].id }
  } catch (error) {
    console.error('Unable to load roadmap data from localStorage', error)
    return defaultState
  }
}

const INITIAL_STORED_STATE = loadStoredState()

function App() {
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>(INITIAL_STORED_STATE.roadmaps)
  const [activeRoadmapId, setActiveRoadmapId] = useState<string | null>(INITIAL_STORED_STATE.activeRoadmapId)
  const [roadmapDraft, setRoadmapDraft] = useState<RoadmapDraft>(createRoadmapDraft)
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(buildTaskDraft())
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [isRoadmapDialogOpen, setIsRoadmapDialogOpen] = useState(false)
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [isLaneDialogOpen, setIsLaneDialogOpen] = useState(false)
  const [laneNameDraft, setLaneNameDraft] = useState('')
  const [editingLaneId, setEditingLaneId] = useState<string | null>(null)
  const [isMilestoneDialogOpen, setIsMilestoneDialogOpen] = useState(false)
  const [milestoneDraft, setMilestoneDraft] = useState<MilestoneDraft>(buildMilestoneDraft())
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [draggedOverLaneId, setDraggedOverLaneId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null)
  const [roadmapErrors, setRoadmapErrors] = useState<RoadmapFormErrors>({})
  const [taskErrors, setTaskErrors] = useState<TaskFormErrors>({})
  const [laneErrors, setLaneErrors] = useState<LaneFormErrors>({})
  const [milestoneErrors, setMilestoneErrors] = useState<MilestoneFormErrors>({})

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        roadmaps,
        activeRoadmapId,
      }),
    )
  }, [roadmaps, activeRoadmapId])

  const activeRoadmap = roadmaps.find((roadmap) => roadmap.id === activeRoadmapId) ?? null

  const boardHorizon = useMemo(
    () => (activeRoadmap ? computeBoardHorizon(activeRoadmap) : WORK_DAYS_PER_WEEK * MIN_WEEKS_ON_BOARD),
    [activeRoadmap],
  )

  const boardDays = useMemo(
    () => Array.from({ length: boardHorizon }, (_, index) => index + 1),
    [boardHorizon],
  )

  const availabilityByDay = useMemo(() => {
    if (!activeRoadmap) {
      return []
    }
    return boardDays.map((day) => {
      const committed = getCommittedForDay(activeRoadmap.tasks, day)
      return RESOURCE_FIELDS.reduce((result, field) => {
        result[field.key] = activeRoadmap.capacity[field.key] - committed[field.key]
        return result
      }, createEmptyResources())
    })
  }, [activeRoadmap, boardDays])

  const tasksByLane = useMemo(() => {
    if (!activeRoadmap) {
      return {}
    }
    return activeRoadmap.tasks.reduce<Record<string, Task[]>>((grouped, task) => {
      if (!grouped[task.laneId]) {
        grouped[task.laneId] = []
      }
      grouped[task.laneId].push(task)
      grouped[task.laneId].sort((left, right) => left.startDay - right.startDay)
      return grouped
    }, {})
  }, [activeRoadmap])

  const openTaskModal = () => {
    if (!activeRoadmap) {
      return
    }
    setEditingTaskId(null)
    setTaskDraft(buildTaskDraft(activeRoadmap.lanes[0]?.id ?? ''))
    setTaskErrors({})
    setIsTaskModalOpen(true)
  }

  const openEditTaskModal = (taskId: string) => {
    if (!activeRoadmap) {
      return
    }
    const task = activeRoadmap.tasks.find((t) => t.id === taskId)
    if (!task) {
      return
    }
    setEditingTaskId(taskId)
    setTaskDraft({
      name: task.name,
      laneId: task.laneId,
      duration: task.duration,
      resources: { ...task.resources },
      startDay: task.startDay,
    })
    setTaskErrors({})
    setIsTaskModalOpen(true)
  }

  const openCopyTaskModal = (taskId: string) => {
    if (!activeRoadmap) {
      return
    }
    const task = activeRoadmap.tasks.find((t) => t.id === taskId)
    if (!task) {
      return
    }
    setEditingTaskId(null)
    setTaskDraft({
      name: `Copy of ${task.name}`,
      laneId: task.laneId,
      duration: task.duration,
      resources: { ...task.resources },
      startDay: undefined,
    })
    setTaskErrors({})
    setIsTaskModalOpen(true)
  }

  const closeTaskModal = () => {
    setIsTaskModalOpen(false)
    setTaskDraft(buildTaskDraft(activeRoadmap?.lanes[0]?.id ?? ''))
    setEditingTaskId(null)
    setTaskErrors({})
  }

  const updateRoadmapDraftCapacity = (key: ResourceKey, value: string) => {
    setRoadmapDraft((current) => ({
      ...current,
      capacity: {
        ...current.capacity,
        [key]: toPositiveNumber(value),
      },
    }))
  }

  const updateTaskDraftResources = (key: ResourceKey, value: string) => {
    setTaskDraft((current) => ({
      ...current,
      resources: {
        ...current.resources,
        [key]: toPositiveNumber(value),
      },
    }))
  }

  const openRoadmapDialog = () => {
    setRoadmapDraft(createRoadmapDraft())
    setRoadmapErrors({})
    setIsRoadmapDialogOpen(true)
  }

  const handleCreateRoadmap = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedName = roadmapDraft.name.trim()
    const nextErrors: RoadmapFormErrors = {}
    if (!trimmedName) {
      nextErrors.name = 'Roadmap name is required.'
    }
    if (!roadmapDraft.startDate) {
      nextErrors.startDate = 'Start date is required.'
    }
    if (!roadmapDraft.endDate) {
      nextErrors.endDate = 'End date is required.'
    }
    if (roadmapDraft.startDate && roadmapDraft.endDate) {
      const start = new Date(roadmapDraft.startDate)
      const end = new Date(roadmapDraft.endDate)
      if (end <= start) {
        nextErrors.endDate = 'End date must be after start date.'
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setRoadmapErrors(nextErrors)
      return
    }

    const roadmap: Roadmap = {
      id: buildId(),
      name: trimmedName,
      startDate: roadmapDraft.startDate,
      endDate: roadmapDraft.endDate,
      capacity: roadmapDraft.capacity,
      lanes: createDefaultLanes(),
      tasks: [],
      milestones: [],
    }

    setRoadmaps((current) => [...current, roadmap])
    setActiveRoadmapId(roadmap.id)
    setRoadmapDraft(createRoadmapDraft())
    setRoadmapErrors({})
    setIsRoadmapDialogOpen(false)
    setNotice({ message: `Created roadmap "${trimmedName}"`, variant: 'default' })
  }

  const handleSaveTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeRoadmap) {
      return
    }

    const trimmedName = taskDraft.name.trim()
    const nextErrors: TaskFormErrors = {}
    if (!trimmedName) {
      nextErrors.name = 'Task name is required.'
    }
    if (!taskDraft.laneId) {
      nextErrors.laneId = 'Select a swimlane for this task.'
    }
    if (taskDraft.duration < 1) {
      nextErrors.duration = 'Duration must be at least 1 working day.'
    }
    if (Object.keys(nextErrors).length > 0) {
      setTaskErrors(nextErrors)
      return
    }

    if (editingTaskId) {
      // Edit existing task
      const existingTask = activeRoadmap.tasks.find((t) => t.id === editingTaskId)
      if (!existingTask) {
        return
      }

      let nextStartDay: number

      // If user specified a start day, validate it
      if (taskDraft.startDay !== undefined) {
        const placement = canPlaceTaskAt(
          activeRoadmap,
          taskDraft.laneId,
          taskDraft.startDay,
          taskDraft.duration,
          taskDraft.resources,
          editingTaskId,
        )
        if (!placement.valid) {
          nextErrors.startDay = placement.reason
          setTaskErrors(nextErrors)
          return
        }
        nextStartDay = taskDraft.startDay
      } else {
        // Auto-schedule: Check if lane or duration changed
        const needsRescheduling =
          existingTask.laneId !== taskDraft.laneId || existingTask.duration !== taskDraft.duration

        if (needsRescheduling) {
          // Check if the task fits in its current position with new dimensions
          const fitsInCurrentSpot =
            !hasLaneConflict(
              activeRoadmap.tasks,
              taskDraft.laneId,
              existingTask.startDay,
              taskDraft.duration,
              editingTaskId,
            ) &&
            hasNonNegativeResources(
              activeRoadmap,
              existingTask.startDay,
              taskDraft.duration,
              taskDraft.resources,
              editingTaskId,
            )

          if (fitsInCurrentSpot) {
            nextStartDay = existingTask.startDay
          } else {
            nextStartDay = findNextViableDay(activeRoadmap, taskDraft.laneId, taskDraft.duration, taskDraft.resources)
          }
        } else {
          // Same lane and duration, check if resources changed and still fit
          const resourcesChanged = RESOURCE_FIELDS.some(
            (field) => existingTask.resources[field.key] !== taskDraft.resources[field.key],
          )

          if (resourcesChanged) {
            const fitsInCurrentSpot = hasNonNegativeResources(
              activeRoadmap,
              existingTask.startDay,
              taskDraft.duration,
              taskDraft.resources,
              editingTaskId,
            )

            if (fitsInCurrentSpot) {
              nextStartDay = existingTask.startDay
            } else {
              nextStartDay = findNextViableDay(
                activeRoadmap,
                taskDraft.laneId,
                taskDraft.duration,
                taskDraft.resources,
              )
            }
          } else {
            nextStartDay = existingTask.startDay
          }
        }
      }

      const updatedTask: Task = {
        id: editingTaskId,
        name: trimmedName,
        laneId: taskDraft.laneId,
        duration: taskDraft.duration,
        resources: taskDraft.resources,
        startDay: nextStartDay,
      }

      setRoadmaps((current) =>
        current.map((roadmap) =>
          roadmap.id === activeRoadmap.id
            ? { ...roadmap, tasks: roadmap.tasks.map((t) => (t.id === editingTaskId ? updatedTask : t)) }
            : roadmap,
        ),
      )
      setNotice({
        message: `Updated "${updatedTask.name}" at ${formatBoardDay(nextStartDay, activeRoadmap.startDate)}.`,
        variant: 'default',
      })
    } else {
      // Create new task
      let nextStartDay: number

      // If user specified a start day, validate it
      if (taskDraft.startDay !== undefined) {
        const placement = canPlaceTaskAt(
          activeRoadmap,
          taskDraft.laneId,
          taskDraft.startDay,
          taskDraft.duration,
          taskDraft.resources,
        )
        if (!placement.valid) {
          nextErrors.startDay = placement.reason
          setTaskErrors(nextErrors)
          return
        }
        nextStartDay = taskDraft.startDay
      } else {
        // Auto-schedule to next available slot
        nextStartDay = findNextViableDay(
          activeRoadmap,
          taskDraft.laneId,
          taskDraft.duration,
          taskDraft.resources,
        )
      }

      const task: Task = {
        id: buildId(),
        name: trimmedName,
        laneId: taskDraft.laneId,
        duration: taskDraft.duration,
        resources: taskDraft.resources,
        startDay: nextStartDay,
      }

      setRoadmaps((current) =>
        current.map((roadmap) =>
          roadmap.id === activeRoadmap.id ? { ...roadmap, tasks: [...roadmap.tasks, task] } : roadmap,
        ),
      )
      setNotice({
        message: `Added "${task.name}" at ${formatBoardDay(nextStartDay, activeRoadmap.startDate)}.`,
        variant: 'default',
      })
    }

    setTaskErrors({})
    closeTaskModal()
  }

  const handleAddLane = () => {
    if (!activeRoadmap) {
      return
    }
    setEditingLaneId(null)
    setLaneNameDraft('')
    setLaneErrors({})
    setIsLaneDialogOpen(true)
  }

  const handleEditLane = (laneId: string) => {
    if (!activeRoadmap) {
      return
    }
    const lane = activeRoadmap.lanes.find((l) => l.id === laneId)
    if (!lane) {
      return
    }
    setEditingLaneId(laneId)
    setLaneNameDraft(lane.name)
    setLaneErrors({})
    setIsLaneDialogOpen(true)
  }

  const handleSaveLane = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeRoadmap) {
      return
    }

    const laneName = laneNameDraft.trim()
    if (!laneName) {
      setLaneErrors({ name: 'Swimlane name is required.' })
      return
    }

    if (editingLaneId) {
      // Edit existing lane
      setRoadmaps((current) =>
        current.map((roadmap) =>
          roadmap.id === activeRoadmap.id
            ? {
                ...roadmap,
                lanes: roadmap.lanes.map((lane) =>
                  lane.id === editingLaneId ? { ...lane, name: laneName } : lane,
                ),
              }
            : roadmap,
        ),
      )
      setNotice({ message: `Updated swimlane to "${laneName}".`, variant: 'default' })
    } else {
      // Create new lane
      const newLane: Lane = {
        id: buildId(),
        name: laneName,
      }
      setRoadmaps((current) =>
        current.map((roadmap) =>
          roadmap.id === activeRoadmap.id
            ? {
                ...roadmap,
                lanes: [...roadmap.lanes, newLane],
              }
            : roadmap,
        ),
      )
      setNotice({ message: `Added swimlane "${newLane.name}".`, variant: 'default' })
    }

    setIsLaneDialogOpen(false)
    setLaneNameDraft('')
    setEditingLaneId(null)
    setLaneErrors({})
  }

  const handleAddMilestone = () => {
    if (!activeRoadmap) {
      return
    }
    setEditingMilestoneId(null)
    setMilestoneDraft(buildMilestoneDraft())
    setMilestoneErrors({})
    setIsMilestoneDialogOpen(true)
  }

  const handleEditMilestone = (milestoneId: string) => {
    if (!activeRoadmap) {
      return
    }
    const milestone = activeRoadmap.milestones.find((m) => m.id === milestoneId)
    if (!milestone) {
      return
    }
    setEditingMilestoneId(milestoneId)
    setMilestoneDraft({
      name: milestone.name,
      day: milestone.day,
    })
    setMilestoneErrors({})
    setIsMilestoneDialogOpen(true)
  }

  const handleSaveMilestone = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeRoadmap) {
      return
    }

    const milestoneName = milestoneDraft.name.trim()
    const nextErrors: MilestoneFormErrors = {}
    if (!milestoneName) {
      nextErrors.name = 'Milestone name is required.'
    }
    if (milestoneDraft.day < 1) {
      nextErrors.day = 'Day must be at least 1.'
    }
    if (Object.keys(nextErrors).length > 0) {
      setMilestoneErrors(nextErrors)
      return
    }

    if (editingMilestoneId) {
      // Edit existing milestone
      setRoadmaps((current) =>
        current.map((roadmap) =>
          roadmap.id === activeRoadmap.id
            ? {
                ...roadmap,
                milestones: roadmap.milestones.map((milestone) =>
                  milestone.id === editingMilestoneId
                    ? { ...milestone, name: milestoneName, day: milestoneDraft.day }
                    : milestone,
                ),
              }
            : roadmap,
        ),
      )
      setNotice({
        message: `Updated milestone "${milestoneName}".`,
        variant: 'default',
      })
    } else {
      // Create new milestone
      const newMilestone: Milestone = {
        id: buildId(),
        name: milestoneName,
        day: milestoneDraft.day,
      }
      setRoadmaps((current) =>
        current.map((roadmap) =>
          roadmap.id === activeRoadmap.id
            ? {
                ...roadmap,
                milestones: [...roadmap.milestones, newMilestone].sort((a, b) => a.day - b.day),
              }
            : roadmap,
        ),
      )
      setNotice({
        message: `Added milestone "${newMilestone.name}" at ${formatBoardDay(newMilestone.day, activeRoadmap.startDate)}.`,
        variant: 'default',
      })
    }

    setIsMilestoneDialogOpen(false)
    setMilestoneDraft(buildMilestoneDraft())
    setEditingMilestoneId(null)
    setMilestoneErrors({})
  }

  const handleDeleteMilestone = (milestoneId: string) => {
    if (!activeRoadmap) {
      return
    }

    const milestone = activeRoadmap.milestones.find((m) => m.id === milestoneId)
    if (!milestone) {
      return
    }

    setDeleteIntent({
      kind: 'milestone',
      milestoneId: milestone.id,
      milestoneName: milestone.name,
    })
  }

  const handleDeleteTask = (taskId: string) => {
    if (!activeRoadmap) {
      return
    }

    const task = activeRoadmap.tasks.find((currentTask) => currentTask.id === taskId)
    if (!task) {
      return
    }
    setDeleteIntent({
      kind: 'task',
      taskId: task.id,
      taskName: task.name,
    })
  }

  const handleDeleteRoadmap = (roadmapId: string) => {
    const roadmap = roadmaps.find((currentRoadmap) => currentRoadmap.id === roadmapId)
    if (!roadmap) {
      return
    }

    setDeleteIntent({
      kind: 'roadmap',
      roadmapId: roadmap.id,
      roadmapName: roadmap.name,
    })
  }

  const handleDeleteLane = (laneId: string) => {
    if (!activeRoadmap) {
      return
    }

    if (activeRoadmap.lanes.length <= 1) {
      setNotice({ message: 'At least one swimlane is required.', variant: 'destructive' })
      return
    }

    const lane = activeRoadmap.lanes.find((currentLane) => currentLane.id === laneId)
    if (!lane) {
      return
    }

    const tasksInLane = activeRoadmap.tasks.filter((task) => task.laneId === laneId)
    setDeleteIntent({
      kind: 'lane',
      laneId: lane.id,
      laneName: lane.name,
      taskCount: tasksInLane.length,
    })
  }

  const handleConfirmDelete = () => {
    if (!deleteIntent) {
      return
    }

    if (deleteIntent.kind === 'roadmap') {
      const remainingRoadmaps = roadmaps.filter((roadmap) => roadmap.id !== deleteIntent.roadmapId)
      setRoadmaps(remainingRoadmaps)
      if (activeRoadmapId === deleteIntent.roadmapId) {
        setActiveRoadmapId(remainingRoadmaps[0]?.id ?? null)
      }
      setNotice({ message: `Removed roadmap "${deleteIntent.roadmapName}".`, variant: 'default' })
      setDeleteIntent(null)
      return
    }

    if (!activeRoadmap) {
      setDeleteIntent(null)
      return
    }

    if (deleteIntent.kind === 'task') {
      setRoadmaps((current) =>
        current.map((roadmap) =>
          roadmap.id === activeRoadmap.id
            ? {
                ...roadmap,
                tasks: roadmap.tasks.filter((task) => task.id !== deleteIntent.taskId),
              }
            : roadmap,
        ),
      )
      setNotice({ message: `Removed task "${deleteIntent.taskName}".`, variant: 'default' })
      setDeleteIntent(null)
      return
    }

    if (deleteIntent.kind === 'milestone') {
      setRoadmaps((current) =>
        current.map((roadmap) =>
          roadmap.id === activeRoadmap.id
            ? {
                ...roadmap,
                milestones: roadmap.milestones.filter((milestone) => milestone.id !== deleteIntent.milestoneId),
              }
            : roadmap,
        ),
      )
      setNotice({ message: `Removed milestone "${deleteIntent.milestoneName}".`, variant: 'default' })
      setDeleteIntent(null)
      return
    }

    if (activeRoadmap.lanes.length <= 1) {
      setNotice({ message: 'At least one swimlane is required.', variant: 'destructive' })
      setDeleteIntent(null)
      return
    }

    const remainingLanes = activeRoadmap.lanes.filter((lane) => lane.id !== deleteIntent.laneId)
    if (taskDraft.laneId === deleteIntent.laneId) {
      setTaskDraft((current) => ({ ...current, laneId: remainingLanes[0]?.id ?? '' }))
    }

    setRoadmaps((current) =>
      current.map((roadmap) =>
        roadmap.id === activeRoadmap.id
          ? {
              ...roadmap,
              lanes: roadmap.lanes.filter((lane) => lane.id !== deleteIntent.laneId),
              tasks: roadmap.tasks.filter((task) => task.laneId !== deleteIntent.laneId),
            }
          : roadmap,
      ),
    )
    setNotice({ message: `Removed swimlane "${deleteIntent.laneName}".`, variant: 'default' })
    setDeleteIntent(null)
  }

  const handleTaskDragStart = (event: DragEvent<HTMLDivElement>, taskId: string) => {
    event.dataTransfer.setData('text/task-id', taskId)
    event.dataTransfer.effectAllowed = 'move'
    setDraggingTaskId(taskId)
  }

  const handleTaskDragEnd = () => {
    setDraggingTaskId(null)
    setDraggedOverLaneId(null)
  }

  const handleLaneDrop = (event: DragEvent<HTMLDivElement>, laneId: string) => {
    event.preventDefault()
    if (!activeRoadmap) {
      return
    }

    const droppedTaskId = draggingTaskId ?? event.dataTransfer.getData('text/task-id')
    const movingTask = activeRoadmap.tasks.find((task) => task.id === droppedTaskId)
    if (!movingTask) {
      setDraggingTaskId(null)
      setDraggedOverLaneId(null)
      return
    }

    const laneRect = event.currentTarget.getBoundingClientRect()
    const rawDropDay = Math.floor((event.clientY - laneRect.top) / ROW_HEIGHT) + 1
    const clampedDropDay = Math.max(1, rawDropDay)

    const nextFreeDay = findNextLaneFreeDay(
      activeRoadmap.tasks,
      laneId,
      movingTask.duration,
      clampedDropDay,
      movingTask.id,
    )

    setRoadmaps((current) =>
      current.map((roadmap) =>
        roadmap.id === activeRoadmap.id
          ? {
              ...roadmap,
              tasks: roadmap.tasks.map((task) =>
                task.id === movingTask.id
                  ? {
                      ...task,
                      laneId,
                      startDay: nextFreeDay,
                    }
                  : task,
              ),
            }
          : roadmap,
      ),
    )
    setNotice({
      message: `Moved "${movingTask.name}" to ${formatBoardDay(nextFreeDay, activeRoadmap.startDate)}.`,
      variant: 'default',
    })
    setDraggingTaskId(null)
    setDraggedOverLaneId(null)
  }

  const renderAvailabilityClass = (value: number) => {
    if (value < 0) {
      return 'resource-value resource-value-negative'
    }
    if (value === 0) {
      return 'resource-value resource-value-zero'
    }
    return 'resource-value'
  }

  const handleExportToCSV = () => {
    if (!activeRoadmap) {
      return
    }

    // Create CSV data for CSV Gantt chart
    const csvRows: string[] = []
    
    // Header row
    csvRows.push('Task Name,Lane,Start Date,End Date,Duration (days),Backend,Frontend,Designers,QA')
    
    // Add tasks
    activeRoadmap.tasks.forEach((task) => {
      const lane = activeRoadmap.lanes.find((l) => l.id === task.laneId)
      const startDate = boardDayToDate(activeRoadmap.startDate, task.startDay)
      const endDate = boardDayToDate(activeRoadmap.startDate, getTaskEndDay(task))
      
      csvRows.push(
        [
          `"${task.name.replace(/"/g, '""')}"`,
          `"${lane?.name || 'Unknown'}"`,
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0],
          task.duration,
          formatResourceValue(task.resources.backend),
          formatResourceValue(task.resources.frontend),
          formatResourceValue(task.resources.designers),
          formatResourceValue(task.resources.qa),
        ].join(','),
      )
    })
    
    // Add empty row separator
    csvRows.push('')
    
    // Add milestones section
    csvRows.push('Milestone Name,Date,Day')
    activeRoadmap.milestones.forEach((milestone) => {
      const milestoneDate = boardDayToDate(activeRoadmap.startDate, milestone.day)
      csvRows.push(
        [
          `"${milestone.name.replace(/"/g, '""')}"`,
          milestoneDate.toISOString().split('T')[0],
          milestone.day,
        ].join(','),
      )
    })
    
    // Create and download file
    const csvContent = csvRows.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    
    link.setAttribute('href', url)
    link.setAttribute('download', `${activeRoadmap.name.replace(/[^a-z0-9]/gi, '_')}_gantt.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    setNotice({ message: 'Exported roadmap data to CSV.', variant: 'default' })
  }

  const deleteDialogTitle =
    deleteIntent?.kind === 'task'
      ? 'Delete task?'
      : deleteIntent?.kind === 'lane'
        ? 'Delete swimlane?'
        : deleteIntent?.kind === 'roadmap'
          ? 'Delete roadmap?'
          : deleteIntent?.kind === 'milestone'
            ? 'Delete milestone?'
            : ''

  const deleteDialogDescription =
    deleteIntent?.kind === 'task'
      ? `This will remove "${deleteIntent.taskName}".`
      : deleteIntent?.kind === 'lane'
        ? `This will remove "${deleteIntent.laneName}"${
            deleteIntent.taskCount > 0
              ? ` and ${deleteIntent.taskCount} task${deleteIntent.taskCount === 1 ? '' : 's'} in it`
              : ''
          }.`
        : deleteIntent?.kind === 'roadmap'
          ? `This will remove roadmap "${deleteIntent.roadmapName}" and all of its tasks.`
          : deleteIntent?.kind === 'milestone'
            ? `This will remove milestone "${deleteIntent.milestoneName}".`
            : ''

  return (
    <div className="app-shell">
      <header className="app-header app-bar">
        <div className="app-bar-row">
          <div className="app-bar-logo-slot">
            <img src="/logo.png" alt="Ignite logo" className="app-logo" />
          </div>
          <div className="app-brand app-brand-center">
            <span>Ignite Roadmapping Tool</span>
          </div>
          <div className="app-bar-actions">
            <Button type="button" onClick={openRoadmapDialog}>
              Create new roadmap
            </Button>
          </div>
        </div>
      </header>

      {notice ? (
        <Alert variant={notice.variant} className="notice-alert">
          <AlertTitle>{notice.variant === 'destructive' ? 'Attention' : 'Update'}</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}

      <main className="workspace-layout">
        <section className="panel roadmap-selector-panel">
          <h2>Roadmaps</h2>
          {roadmaps.length === 0 ? (
            <p className="empty">No roadmaps yet. Click "Create new roadmap" to get started.</p>
          ) : (
            <div className="roadmap-list roadmap-list-horizontal">
              {roadmaps.map((roadmap) => (
                <div key={roadmap.id} className={`roadmap-item ${roadmap.id === activeRoadmapId ? 'active' : ''}`}>
                  <Button
                    type="button"
                    variant="outline"
                    className="roadmap-item-main"
                    onClick={() => setActiveRoadmapId(roadmap.id)}
                  >
                    {roadmap.name}
                    <span>
                      {roadmap.tasks.length} task{roadmap.tasks.length === 1 ? '' : 's'}
                    </span>
                  </Button>
                  <div className="roadmap-resource-row">
                    {RESOURCE_FIELDS.map((field) => (
                      <small key={field.key}>
                        {field.short}: {roadmap.capacity[field.key]}
                      </small>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="roadmap-delete-button"
                    onClick={() => handleDeleteRoadmap(roadmap.id)}
                    aria-label={`Delete ${roadmap.name} roadmap`}
                  >
                    Delete roadmap
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="board-area">
          {!activeRoadmap ? (
            <div className="panel empty-board">
              <h2>No board selected</h2>
              <p>Create a roadmap to open its board view.</p>
            </div>
          ) : (
            <>
              <section className="panel board-toolbar">
                <div>
                  <h2>{activeRoadmap.name}</h2>
                  <p>
                    {formatDate(new Date(activeRoadmap.startDate))} to {formatDate(new Date(activeRoadmap.endDate))} •{' '}
                    {activeRoadmap.lanes.length} swimlanes, {activeRoadmap.tasks.length} task
                    {activeRoadmap.tasks.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="button-row">
                  <Button type="button" onClick={handleAddLane}>
                    Add swimlane
                  </Button>
                  <Button type="button" onClick={openTaskModal} disabled={activeRoadmap.lanes.length < 1}>
                    Add task
                  </Button>
                  <Button type="button" onClick={handleAddMilestone}>
                    Add milestone
                  </Button>
                  <Button type="button" variant="outline" onClick={handleExportToCSV}>
                    Export to CSV
                  </Button>
                </div>
              </section>

              <section className="panel timeline-panel">
                <h3>Roadmap board (weeks/days top to bottom)</h3>
                <div className="timeline">
                  <div className="timeline-header-row">
                    <div className="timeline-axis-header">Week / Day</div>
                    <div
                      className="lane-headers"
                      style={{ gridTemplateColumns: `repeat(${activeRoadmap.lanes.length}, minmax(220px, 1fr))` }}
                    >
                      {activeRoadmap.lanes.map((lane) => (
                        <div key={lane.id} className="lane-header">
                          <span className="lane-title">{lane.name}</span>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="icon-button"
                              onClick={() => handleEditLane(lane.id)}
                              aria-label={`Edit ${lane.name} swimlane`}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="xs"
                              className="icon-button icon-button-danger lane-remove-button"
                              onClick={() => handleDeleteLane(lane.id)}
                              aria-label={`Remove ${lane.name} swimlane`}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="timeline-body">
                    <div className="day-axis">
                      {boardDays.map((day, index) => {
                        const week = Math.floor((day - 1) / WORK_DAYS_PER_WEEK) + 1
                        const dayOfWeek = ((day - 1) % WORK_DAYS_PER_WEEK) + 1
                        const availability = availabilityByDay[index]
                        return (
                          <div key={day} className={`day-cell ${dayOfWeek === 1 ? 'week-start' : ''}`}>
                            <div className="left-day-cell">
                              <span>W{week}</span>
                              <strong>D{dayOfWeek}</strong>
                              <small>Day {day}</small>
                            </div>

                            <div className='right-day-cell'>
                              {RESOURCE_FIELDS.map((field) => (
                                <div key={field.key}>
                                  <span className={renderAvailabilityClass(availability[field.key])}>
                                    {field.short} : {formatResourceValue(availability[field.key])}
                                  </span>
                                  <br />
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div
                      className="lane-columns"
                      style={{
                        position: 'relative',
                        gridTemplateColumns: `repeat(${activeRoadmap.lanes.length}, minmax(220px, 1fr))`,
                        minHeight: `${boardHorizon * ROW_HEIGHT}px`,
                      }}
                    >
                      {activeRoadmap.lanes.map((lane) => (
                        <div
                          key={lane.id}
                          className={`lane-column ${draggedOverLaneId === lane.id ? 'lane-column-drop' : ''}`}
                          style={{ minHeight: `${boardHorizon * ROW_HEIGHT}px` }}
                          onDragOver={(event) => {
                            event.preventDefault()
                            setDraggedOverLaneId(lane.id)
                          }}
                          onDragLeave={() => setDraggedOverLaneId((current) => (current === lane.id ? null : current))}
                          onDrop={(event) => handleLaneDrop(event, lane.id)}
                        >
                          {(tasksByLane[lane.id] ?? []).map((task) => (
                            <div
                              key={task.id}
                              draggable
                              className="task-card"
                              style={{
                                top: `${(task.startDay - 1) * ROW_HEIGHT + 6}px`,
                                height: `${task.duration * ROW_HEIGHT - 12}px`,
                              }}
                              onDragStart={(event) => handleTaskDragStart(event, task.id)}
                              onDragEnd={handleTaskDragEnd}
                            >
                              <div className="task-card-header">
                                <strong>{task.name}</strong>
                                <div style={{ display: 'flex', gap: '0.25rem' }}>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    className="icon-button"
                                    onMouseDown={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                    }}
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      openEditTaskModal(task.id)
                                    }}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    className="icon-button"
                                    onMouseDown={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                    }}
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      openCopyTaskModal(task.id)
                                    }}
                                  >
                                    Copy
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="xs"
                                    className="icon-button icon-button-danger"
                                    onMouseDown={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                    }}
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      handleDeleteTask(task.id)
                                    }}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </div>
                              <span>
                                {formatBoardDay(task.startDay, activeRoadmap.startDate)} to{' '}
                                {formatBoardDay(getTaskEndDay(task), activeRoadmap.startDate)}
                              </span>
                              <div className="task-resource-row">
                                {RESOURCE_FIELDS.map((field) => (
                                  <small key={field.key}>
                                    {field.short}: {formatResourceValue(task.resources[field.key])}
                                  </small>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                      
                      {/* Milestone overlays */}
                      {activeRoadmap.milestones.map((milestone) => (
                        <div
                          key={milestone.id}
                          className="milestone-line"
                          style={{
                            position: 'absolute',
                            top: `${milestone.day * ROW_HEIGHT}px`,
                            left: 0,
                            right: 0,
                            height: '2px',
                            backgroundColor: '#ff6b6b',
                            zIndex: 10,
                            pointerEvents: 'none',
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              top: '-20px',
                              left: '8px',
                              backgroundColor: '#ff6b6b',
                              color: 'white',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                              whiteSpace: 'nowrap',
                              pointerEvents: 'auto',
                              cursor: 'pointer',
                            }}
                            onClick={() => handleEditMilestone(milestone.id)}
                            title="Click to edit milestone"
                          >
                            {milestone.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section className="panel capacity-panel">
                <h3>Daily resource availability</h3>
                <p className="helper">
                  Values are remaining resources after all tasks on that day. Zero and negative are highlighted.
                </p>
                <div className="capacity-table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Day</th>
                        {RESOURCE_FIELDS.map((field) => (
                          <th key={field.key}>{field.short}</th>
                        ))}
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {boardDays.map((day, index) => {
                        const availability = availabilityByDay[index]
                        const hasNegative = RESOURCE_FIELDS.some(
                          (field) => availability && availability[field.key] < 0,
                        )
                        const hasZero = RESOURCE_FIELDS.some(
                          (field) => availability && availability[field.key] === 0,
                        )

                        return (
                          <tr key={day} className={hasNegative ? 'status-negative' : hasZero ? 'status-zero' : ''}>
                            <td>{formatBoardDay(day, activeRoadmap.startDate)}</td>
                            {RESOURCE_FIELDS.map((field) => (
                              <td key={field.key} className={renderAvailabilityClass(availability[field.key])}>
                                {formatResourceValue(availability[field.key])}
                              </td>
                            ))}
                            <td>{hasNegative ? 'Overbooked' : hasZero ? 'At limit' : 'Available'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </section>
      </main>

      <Dialog
        open={isRoadmapDialogOpen}
        onOpenChange={(isOpen) => {
          setIsRoadmapDialogOpen(isOpen)
          if (!isOpen) {
            setRoadmapErrors({})
          }
        }}
      >
        <DialogContent className="app-dialog-content app-roadmap-dialog">
          <DialogHeader>
            <DialogTitle>Create roadmap</DialogTitle>
            <DialogDescription>
              Enter roadmap name and team capacity. A new roadmap board will be created.
            </DialogDescription>
          </DialogHeader>
          <form className="stack-form" onSubmit={handleCreateRoadmap}>
            <div className="form-field">
              <FieldLabel htmlFor="roadmap-name">Roadmap name</FieldLabel>
              <Input
                id="roadmap-name"
                value={roadmapDraft.name}
                onChange={(event) => {
                  setRoadmapDraft((current) => ({ ...current, name: event.target.value }))
                  if (roadmapErrors.name) {
                    setRoadmapErrors((current) => ({ ...current, name: undefined }))
                  }
                }}
                placeholder="Q2 Platform Modernization"
                aria-invalid={roadmapErrors.name ? 'true' : 'false'}
              />
              <FieldError>{roadmapErrors.name}</FieldError>
            </div>

            <div className="form-field">
              <FieldLabel htmlFor="roadmap-start-date">Start date</FieldLabel>
              <Input
                id="roadmap-start-date"
                type="date"
                value={roadmapDraft.startDate}
                onChange={(event) => {
                  setRoadmapDraft((current) => ({ ...current, startDate: event.target.value }))
                  if (roadmapErrors.startDate) {
                    setRoadmapErrors((current) => ({ ...current, startDate: undefined }))
                  }
                }}
                aria-invalid={roadmapErrors.startDate ? 'true' : 'false'}
              />
              <FieldError>{roadmapErrors.startDate}</FieldError>
            </div>

            <div className="form-field">
              <FieldLabel htmlFor="roadmap-end-date">End date</FieldLabel>
              <Input
                id="roadmap-end-date"
                type="date"
                value={roadmapDraft.endDate}
                onChange={(event) => {
                  setRoadmapDraft((current) => ({ ...current, endDate: event.target.value }))
                  if (roadmapErrors.endDate) {
                    setRoadmapErrors((current) => ({ ...current, endDate: undefined }))
                  }
                }}
                aria-invalid={roadmapErrors.endDate ? 'true' : 'false'}
              />
              <FieldError>{roadmapErrors.endDate}</FieldError>
            </div>

            <div className="resource-grid">
              {RESOURCE_FIELDS.map((field) => (
                <div key={field.key} className="resource-field">
                  <FieldLabel htmlFor={`roadmap-${field.key}`}>{field.label}</FieldLabel>
                  <Input
                    id={`roadmap-${field.key}`}
                    type="number"
                    min={0}
                    step="0.1"
                    value={roadmapDraft.capacity[field.key]}
                    onChange={(event) => updateRoadmapDraftCapacity(field.key, event.target.value)}
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                className="secondary-button"
                onClick={() => {
                  setIsRoadmapDialogOpen(false)
                  setRoadmapErrors({})
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Create roadmap board</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {isTaskModalOpen && activeRoadmap ? (
        <div className="modal-backdrop" onClick={closeTaskModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>{editingTaskId ? 'Edit task' : 'Add task'}</h2>
            <form className="stack-form" onSubmit={handleSaveTask}>
              <div className="form-field">
                <FieldLabel htmlFor="task-name">Task name</FieldLabel>
                <Input
                  id="task-name"
                  value={taskDraft.name}
                  onChange={(event) => {
                    setTaskDraft((current) => ({ ...current, name: event.target.value }))
                    if (taskErrors.name) {
                      setTaskErrors((current) => ({ ...current, name: undefined }))
                    }
                  }}
                  placeholder="Build customer-facing timeline"
                  aria-invalid={taskErrors.name ? 'true' : 'false'}
                />
                <FieldError>{taskErrors.name}</FieldError>
              </div>

              <div className="form-field">
                <FieldLabel htmlFor="task-lane">Swimlane</FieldLabel>
                <select
                  id="task-lane"
                  value={taskDraft.laneId}
                  onChange={(event) => {
                    setTaskDraft((current) => ({ ...current, laneId: event.target.value }))
                    if (taskErrors.laneId) {
                      setTaskErrors((current) => ({ ...current, laneId: undefined }))
                    }
                  }}
                  aria-invalid={taskErrors.laneId ? 'true' : 'false'}
                >
                  {activeRoadmap.lanes.map((lane) => (
                    <option key={lane.id} value={lane.id}>
                      {lane.name}
                    </option>
                  ))}
                </select>
                <FieldError>{taskErrors.laneId}</FieldError>
              </div>

              <div className="form-field">
                <FieldLabel htmlFor="task-duration">Duration (working days)</FieldLabel>
                <Input
                  id="task-duration"
                  type="number"
                  min={1}
                  value={taskDraft.duration}
                  onChange={(event) => {
                    if (taskErrors.duration) {
                      setTaskErrors((current) => ({ ...current, duration: undefined }))
                    }
                    setTaskDraft((current) => ({
                      ...current,
                      duration: Math.max(1, toPositiveInt(event.target.value, 1)),
                    }))
                  }}
                  aria-invalid={taskErrors.duration ? 'true' : 'false'}
                />
                <FieldError>{taskErrors.duration}</FieldError>
              </div>

              <div className="form-field">
                <FieldLabel htmlFor="task-start-day">Start date (optional)</FieldLabel>
                <Input
                  id="task-start-day"
                  type="date"
                  value={
                    taskDraft.startDay
                      ? dateToISOString(boardDayToDate(activeRoadmap.startDate, taskDraft.startDay))
                      : ''
                  }
                  onChange={(event) => {
                    if (taskErrors.startDay) {
                      setTaskErrors((current) => ({ ...current, startDay: undefined }))
                    }
                    const dateValue = event.target.value
                    if (dateValue) {
                      const boardDay = dateToBoardDay(activeRoadmap.startDate, dateValue)
                      setTaskDraft((current) => ({ ...current, startDay: boardDay }))
                    } else {
                      setTaskDraft((current) => ({ ...current, startDay: undefined }))
                    }
                  }}
                  aria-invalid={taskErrors.startDay ? 'true' : 'false'}
                />
                <FieldError>{taskErrors.startDay}</FieldError>
                {!taskErrors.startDay && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Leave blank to auto-schedule at the next available slot
                  </p>
                )}
              </div>

              <div className="resource-grid">
                {RESOURCE_FIELDS.map((field) => (
                  <div key={field.key} className="resource-field">
                    <FieldLabel htmlFor={`task-${field.key}`}>{field.label}</FieldLabel>
                    <Input
                      id={`task-${field.key}`}
                      type="number"
                      min={0}
                      step="0.1"
                      value={taskDraft.resources[field.key]}
                      onChange={(event) => updateTaskDraftResources(field.key, event.target.value)}
                    />
                  </div>
                ))}
              </div>

              <div className="button-row">
                <Button type="button" variant="secondary" className="secondary-button" onClick={closeTaskModal}>
                  Cancel
                </Button>
                <Button type="submit">{editingTaskId ? 'Save' : 'Add task'}</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <Dialog
        open={isLaneDialogOpen}
        onOpenChange={(isOpen) => {
          setIsLaneDialogOpen(isOpen)
          if (!isOpen) {
            setLaneNameDraft('')
            setEditingLaneId(null)
          }
        }}
      >
        <DialogContent className="app-dialog-content">
          <DialogHeader>
            <DialogTitle>{editingLaneId ? 'Edit swimlane' : 'Add swimlane'}</DialogTitle>
            <DialogDescription>
              {editingLaneId
                ? 'Update the name of this swimlane.'
                : 'Create a new vertical swimlane for task placement.'}
            </DialogDescription>
          </DialogHeader>
          <form className="stack-form" onSubmit={handleSaveLane}>
            <div className="form-field">
              <FieldLabel htmlFor="lane-name">Swimlane name</FieldLabel>
              <Input
                id="lane-name"
                value={laneNameDraft}
                onChange={(event) => {
                  setLaneNameDraft(event.target.value)
                  if (laneErrors.name) {
                    setLaneErrors({ name: undefined })
                  }
                }}
                placeholder="Infrastructure"
                autoFocus
                aria-invalid={laneErrors.name ? 'true' : 'false'}
              />
              <FieldError>{laneErrors.name}</FieldError>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                className="secondary-button"
                onClick={() => {
                  setIsLaneDialogOpen(false)
                  setLaneNameDraft('')
                  setEditingLaneId(null)
                }}
              >
                Cancel
              </Button>
              <Button type="submit">{editingLaneId ? 'Save' : 'Add swimlane'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isMilestoneDialogOpen}
        onOpenChange={(isOpen) => {
          setIsMilestoneDialogOpen(isOpen)
          if (!isOpen) {
            setMilestoneDraft(buildMilestoneDraft())
            setEditingMilestoneId(null)
          }
        }}
      >
        <DialogContent className="app-dialog-content">
          <DialogHeader>
            <DialogTitle>{editingMilestoneId ? 'Edit milestone' : 'Add milestone'}</DialogTitle>
            <DialogDescription>
              {editingMilestoneId
                ? 'Update the milestone details.'
                : 'Create a milestone marker on the roadmap timeline.'}
            </DialogDescription>
          </DialogHeader>
          <form className="stack-form" onSubmit={handleSaveMilestone}>
            <div className="form-field">
              <FieldLabel htmlFor="milestone-name">Milestone name</FieldLabel>
              <Input
                id="milestone-name"
                value={milestoneDraft.name}
                onChange={(event) => {
                  setMilestoneDraft((current) => ({ ...current, name: event.target.value }))
                  if (milestoneErrors.name) {
                    setMilestoneErrors((current) => ({ ...current, name: undefined }))
                  }
                }}
                placeholder="Beta Release"
                autoFocus
                aria-invalid={milestoneErrors.name ? 'true' : 'false'}
              />
              <FieldError>{milestoneErrors.name}</FieldError>
            </div>
            <div className="form-field">
              <FieldLabel htmlFor="milestone-day">Day (board day number)</FieldLabel>
              <Input
                id="milestone-day"
                type="number"
                min={1}
                max={activeRoadmap ? boardHorizon : undefined}
                value={milestoneDraft.day}
                onChange={(event) => {
                  setMilestoneDraft((current) => ({
                    ...current,
                    day: Math.max(1, toPositiveInt(event.target.value, 1)),
                  }))
                  if (milestoneErrors.day) {
                    setMilestoneErrors((current) => ({ ...current, day: undefined }))
                  }
                }}
                aria-invalid={milestoneErrors.day ? 'true' : 'false'}
              />
              <FieldError>{milestoneErrors.day}</FieldError>
              {activeRoadmap && milestoneDraft.day >= 1 && (
                <p style={{ fontSize: '12px', marginTop: '4px', color: '#666' }}>
                  {formatBoardDay(milestoneDraft.day, activeRoadmap.startDate)}
                </p>
              )}
            </div>
            <DialogFooter>
              {editingMilestoneId && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setIsMilestoneDialogOpen(false)
                    handleDeleteMilestone(editingMilestoneId)
                  }}
                  style={{ marginRight: 'auto' }}
                >
                  Delete
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                className="secondary-button"
                onClick={() => {
                  setIsMilestoneDialogOpen(false)
                  setMilestoneDraft(buildMilestoneDraft())
                  setEditingMilestoneId(null)
                }}
              >
                Cancel
              </Button>
              <Button type="submit">{editingMilestoneId ? 'Save' : 'Add milestone'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteIntent !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setDeleteIntent(null)
          }
        }}
      >
        <AlertDialogContent className="app-alert-content" size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{deleteDialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="secondary-button">Cancel</AlertDialogCancel>
            <AlertDialogAction className="alert-action-danger" onClick={handleConfirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default App
