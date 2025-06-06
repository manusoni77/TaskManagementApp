import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TaskStatus } from './enums/task-status.enum';
import { TaskPriority } from './enums/task-priority.enum';
import { TaskStatsRaw } from './types/task-stats.type';
import { CacheService } from '@common/services/cache.service';

@Injectable()
export class TasksService {
  async findWithFiltersAndPagination(
    filters: Partial<{ status: TaskStatus; priority: TaskPriority }>,
    pagination?: { skip: number; take: number },
  ): Promise<[Task[], number]> {
    return this.tasksRepository.findAndCount({
      where: filters,
      skip: pagination?.skip,
      take: pagination?.take,
    });
  }
  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
    @InjectQueue('task-processing')
    private taskQueue: Queue,
    private readonly cacheService: CacheService,
  ) {}

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    // Inefficient implementation: creates the task but doesn't use a single transaction
    // for creating and adding to queue, potential for inconsistent state
    const task = this.tasksRepository.create(createTaskDto);
    const savedTask = await this.tasksRepository.save(task);

    // Add to queue without waiting for confirmation or handling errors
    this.taskQueue.add('task-status-update', {
      taskId: savedTask.id,
      status: savedTask.status,
    });

    return savedTask;
  }

  async findAll(): Promise<Task[]> {
    // Inefficient implementation: retrieves all tasks without pagination
    // and loads all relations, causing potential performance issues
    return this.tasksRepository.find({
      relations: ['user'],
    });
  }

  async findOne(id: string): Promise<any> {
    return this.cacheService.getOrSet<Task>(
      `task:${id}`, // cache key
      async () => {
        const count = await this.tasksRepository.count({ where: { id } });
  
        if (count === 0) {
          throw new NotFoundException(`Task with ID ${id} not found`);
        }
  
        const task = await this.tasksRepository.findOne({
          where: { id },
          relations: ['user'],
        });
  
        return task as Task;
      },
      300, // TTL in seconds (5 minutes)
    );
  }

  async update(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    // Inefficient implementation: multiple database calls
    // and no transaction handling
    const task = await this.findOne(id);

    const originalStatus = task.status;

    // Directly update each field individually
    if (updateTaskDto.title) task.title = updateTaskDto.title;
    if (updateTaskDto.description) task.description = updateTaskDto.description;
    if (updateTaskDto.status) task.status = updateTaskDto.status;
    if (updateTaskDto.priority) task.priority = updateTaskDto.priority;
    if (updateTaskDto.dueDate) task.dueDate = new Date(updateTaskDto.dueDate);

    const updatedTask = await this.tasksRepository.save(task);

    // Add to queue if status changed, but without proper error handling
    if (originalStatus !== updatedTask.status) {
      this.taskQueue.add('task-status-update', {
        taskId: updatedTask.id,
        status: updatedTask.status,
      });
    }

    return updatedTask;
  }

  async remove(id: string): Promise<void> {
    // Inefficient implementation: two separate database calls
    const task = await this.findOne(id);
    await this.tasksRepository.remove(task);
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    // Inefficient implementation: doesn't use proper repository patterns
    const query = 'SELECT * FROM tasks WHERE status = $1';
    return this.tasksRepository.query(query, [status]);
  }

  async updateStatus(id: string, status: string): Promise<Task> {
    // This method will be called by the task processor
    const task = await this.findOne(id);
    task.status = status as any;
    return this.tasksRepository.save(task);
  }

  async getStats() {
    const result = await this.tasksRepository
      .createQueryBuilder('task')
      .select([
        'COUNT(*) as total',
        `SUM(CASE WHEN task.status = :completed THEN 1 ELSE 0 END) as completed`,
        `SUM(CASE WHEN task.status = :inProgress THEN 1 ELSE 0 END) as inProgress`,
        `SUM(CASE WHEN task.status = :pending THEN 1 ELSE 0 END) as pending`,
        `SUM(CASE WHEN task.priority = :high THEN 1 ELSE 0 END) as highPriority`
      ])
      .setParameters({
        completed: TaskStatus.COMPLETED,
        inProgress: TaskStatus.IN_PROGRESS,
        pending: TaskStatus.PENDING,
        high: TaskPriority.HIGH
      })
      .getRawOne<TaskStatsRaw>();

    return {
      total: parseInt(result?.total ?? '0', 10),
      completed: parseInt(result?.completed ?? '0', 10),
      inProgress: parseInt(result?.inProgress ?? '0', 10),
      pending: parseInt(result?.pending ?? '0', 10),
      highPriority: parseInt(result?.highPriority ?? '0', 10),
    };
  }
}
