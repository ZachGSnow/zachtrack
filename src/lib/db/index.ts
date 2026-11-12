// The local database (Dexie over IndexedDB), in parts: the record types,
// the schema, the record functions by area and what sync uses. Import from
// here ('../db'); the helpers the parts share (uuid, notifyMutation,
// addTombstone, removeTasks) stay inside this folder.

export * from './types';
export { db, onLocalMutation, ZachTrackDB } from './schema';
export * from './records';
export {
  completeTask,
  createTask,
  createTaskProject,
  deleteTask,
  deleteTaskProject,
  deleteTaskSection,
  duplicateTask,
  setTaskParent,
  skipTask,
  undoComplete,
  updateTask,
  updateTaskProject,
  type TaskCompleteResult,
} from './tasks';
export * from './sync';
export * from './starter';
