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
  capacity: ResourceSet
  lanes: Lane[]
  tasks: Task[]
}

type RoadmapDraft = {
  name: string
  capacity: ResourceSet
}

type TaskDraft = {
  name: string
  laneId: string
  duration: number
  resources: ResourceSet
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

type Notice = {
  message: string
  variant: 'default' | 'destructive'
}

type RoadmapFormErrors = {
  name?: string
}

type TaskFormErrors = {
  name?: string
  laneId?: string
  duration?: string
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

const createRoadmapDraft = (): RoadmapDraft => ({
  name: '',
  capacity: {
    backend: 2,
    frontend: 2,
    designers: 1,
    qa: 1,
  },
})

const toPositiveInt = (value: string, fallback = 0): number => {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    return fallback
  }
  return Math.max(0, parsed)
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
  const maxEnd = roadmap.tasks.reduce(
    (highest, task) => Math.max(highest, getTaskEndDay(task)),
    WORK_DAYS_PER_WEEK * MIN_WEEKS_ON_BOARD,
  )
  return Math.max(WORK_DAYS_PER_WEEK * MIN_WEEKS_ON_BOARD, maxEnd + WORK_DAYS_PER_WEEK)
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

const formatBoardDay = (day: number) => {
  const week = Math.floor((day - 1) / WORK_DAYS_PER_WEEK) + 1
  const dayOfWeek = ((day - 1) % WORK_DAYS_PER_WEEK) + 1
  return `Week ${week}, Day ${dayOfWeek}`
}

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
    const parsedActiveId =
      typeof parsed.activeRoadmapId === 'string' || parsed.activeRoadmapId === null
        ? parsed.activeRoadmapId
        : null

    if (parsedRoadmaps.length === 0) {
      return defaultState
    }

    if (parsedActiveId && parsedRoadmaps.some((roadmap) => roadmap.id === parsedActiveId)) {
      return { roadmaps: parsedRoadmaps, activeRoadmapId: parsedActiveId }
    }

    return { roadmaps: parsedRoadmaps, activeRoadmapId: parsedRoadmaps[0].id }
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
  const [isRoadmapDialogOpen, setIsRoadmapDialogOpen] = useState(false)
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [isLaneDialogOpen, setIsLaneDialogOpen] = useState(false)
  const [laneNameDraft, setLaneNameDraft] = useState('')
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [draggedOverLaneId, setDraggedOverLaneId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null)
  const [roadmapErrors, setRoadmapErrors] = useState<RoadmapFormErrors>({})
  const [taskErrors, setTaskErrors] = useState<TaskFormErrors>({})
  const [laneErrors, setLaneErrors] = useState<LaneFormErrors>({})

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
    setTaskDraft(buildTaskDraft(activeRoadmap.lanes[0]?.id ?? ''))
    setTaskErrors({})
    setIsTaskModalOpen(true)
  }

  const closeTaskModal = () => {
    setIsTaskModalOpen(false)
    setTaskDraft(buildTaskDraft(activeRoadmap?.lanes[0]?.id ?? ''))
    setTaskErrors({})
  }

  const updateRoadmapDraftCapacity = (key: ResourceKey, value: string) => {
    setRoadmapDraft((current) => ({
      ...current,
      capacity: {
        ...current.capacity,
        [key]: toPositiveInt(value),
      },
    }))
  }

  const updateTaskDraftResources = (key: ResourceKey, value: string) => {
    setTaskDraft((current) => ({
      ...current,
      resources: {
        ...current.resources,
        [key]: toPositiveInt(value),
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

    if (nextErrors.name) {
      setRoadmapErrors(nextErrors)
      return
    }

    const roadmap: Roadmap = {
      id: buildId(),
      name: trimmedName,
      capacity: roadmapDraft.capacity,
      lanes: createDefaultLanes(),
      tasks: [],
    }

    setRoadmaps((current) => [...current, roadmap])
    setActiveRoadmapId(roadmap.id)
    setRoadmapDraft(createRoadmapDraft())
    setRoadmapErrors({})
    setIsRoadmapDialogOpen(false)
    setNotice({ message: `Created roadmap "${trimmedName}"`, variant: 'default' })
  }

  const handleCreateTask = (event: FormEvent<HTMLFormElement>) => {
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

    const nextStartDay = findNextViableDay(
      activeRoadmap,
      taskDraft.laneId,
      taskDraft.duration,
      taskDraft.resources,
    )
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
    setTaskErrors({})
    setNotice({ message: `Added "${task.name}" at ${formatBoardDay(nextStartDay)}.`, variant: 'default' })
    closeTaskModal()
  }

  const handleAddLane = () => {
    if (!activeRoadmap) {
      return
    }
    setLaneNameDraft('')
    setLaneErrors({})
    setIsLaneDialogOpen(true)
  }

  const handleCreateLane = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeRoadmap) {
      return
    }

    const laneName = laneNameDraft.trim()
    if (!laneName) {
      setLaneErrors({ name: 'Swimlane name is required.' })
      return
    }

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
    setIsLaneDialogOpen(false)
    setLaneNameDraft('')
    setLaneErrors({})
    setNotice({ message: `Added swimlane "${newLane.name}".`, variant: 'default' })
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
    setNotice({ message: `Moved "${movingTask.name}" to ${formatBoardDay(nextFreeDay)}.`, variant: 'default' })
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

  const deleteDialogTitle =
    deleteIntent?.kind === 'task'
      ? 'Delete task?'
      : deleteIntent?.kind === 'lane'
        ? 'Delete swimlane?'
        : deleteIntent?.kind === 'roadmap'
          ? 'Delete roadmap?'
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
                                  <span className={renderAvailabilityClass(availability[field.key])}>{field.short} : {availability[field.key]}</span>
                                  <br/>
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
                              <span>
                                {formatBoardDay(task.startDay)} to {formatBoardDay(getTaskEndDay(task))}
                              </span>
                              <div className="task-resource-row">
                                {RESOURCE_FIELDS.map((field) => (
                                  <small key={field.key}>
                                    {field.short}: {task.resources[field.key]}
                                  </small>
                                ))}
                              </div>
                            </div>
                          ))}
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
                            <td>{formatBoardDay(day)}</td>
                            {RESOURCE_FIELDS.map((field) => (
                              <td key={field.key} className={renderAvailabilityClass(availability[field.key])}>
                                {availability[field.key]}
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
            <div className="resource-grid">
              {RESOURCE_FIELDS.map((field) => (
                <div key={field.key} className="resource-field">
                  <FieldLabel htmlFor={`roadmap-${field.key}`}>{field.label}</FieldLabel>
                  <Input
                    id={`roadmap-${field.key}`}
                    type="number"
                    min={0}
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
            <h2>Add task</h2>
            <form className="stack-form" onSubmit={handleCreateTask}>
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

              <div className="resource-grid">
                {RESOURCE_FIELDS.map((field) => (
                  <div key={field.key} className="resource-field">
                    <FieldLabel htmlFor={`task-${field.key}`}>{field.label}</FieldLabel>
                    <Input
                      id={`task-${field.key}`}
                      type="number"
                      min={0}
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
                <Button type="submit">Add task</Button>
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
          }
        }}
      >
        <DialogContent className="app-dialog-content">
          <DialogHeader>
            <DialogTitle>Add swimlane</DialogTitle>
            <DialogDescription>Create a new vertical swimlane for task placement.</DialogDescription>
          </DialogHeader>
          <form className="stack-form" onSubmit={handleCreateLane}>
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
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Add swimlane</Button>
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
