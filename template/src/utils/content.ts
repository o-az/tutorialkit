import type { Chapter, CollectionEntry, Files, Lesson, Part, Tutorial } from '@entities/tutorial';
import type { TutorialSchema } from '@schemas';
import { getCollection } from 'astro:content';
import glob from 'fast-glob';
import fs from 'node:fs';
import path from 'node:path';

let _tutorial: Tutorial | undefined;

const CONTENT_DIR = path.join(import.meta.dirname, '../content/tutorial');
const TEMPLATES_DIR = path.join(import.meta.dirname, '../templates');

export async function getTutorial() {
  if (_tutorial) {
    return _tutorial;
  }

  const collection = await getCollection('tutorial');

  _tutorial = {};

  let tutorialMetaData: TutorialSchema | undefined;

  const lessons: Lesson[] = [];

  for (const entry of collection) {
    const { id, data } = entry;
    const { type } = data;

    const [partId, chapterId, lessonId] = parseId(id);

    if (type === 'tutorial') {
      tutorialMetaData = data;
    } else if (type === 'part') {
      _tutorial[partId] = {
        data,
        slug: getSlug(entry),
        chapters: _tutorial[partId].chapters ?? {},
      };
    } else if (type === 'chapter') {
      if (!_tutorial[partId]) {
        _tutorial[partId] = {
          chapters: {},
        } as Part;
      }

      _tutorial[partId].chapters[chapterId] = {
        data,
        slug: getSlug(entry),
        lessons: _tutorial[partId].chapters[chapterId].lessons ?? [],
      };
    } else if (type === 'lesson') {
      if (!_tutorial[partId]) {
        _tutorial[partId] = {
          chapters: {},
        } as Part;
      }

      if (!_tutorial[partId].chapters[chapterId]) {
        _tutorial[partId].chapters[chapterId] = {
          lessons: {},
        } as unknown as Chapter;
      }

      const { Content } = await entry.render();

      const lessonDir = path.join(CONTENT_DIR, path.dirname(entry.id));
      const filesDir = path.join(lessonDir, '_files');
      const solutionDir = path.join(lessonDir, '_solution');

      // we currently only support a single template
      const templateDir = path.join(TEMPLATES_DIR, 'default');

      const files = await createFileMap(filesDir);
      const templateFiles = await createFileMap(templateDir);
      const solution = await createFileMap(solutionDir);

      const lesson: Lesson = {
        data,
        id: Number(lessonId),
        part: Number(partId),
        chapter: Number(chapterId),
        Markdown: Content,
        slug: getSlug(entry),
        files,
        solution,
        template: templateFiles,
      };

      lessons.push(lesson);

      _tutorial[partId].chapters[chapterId].lessons[lessonId] = lesson;
    }
  }

  lessons.sort((a, b) => {
    const partsA = [a.part, a.chapter, a.id];
    const partsB = [b.part, b.chapter, b.id];

    for (let i = 0; i < partsA.length; i++) {
      if (partsA[i] !== partsB[i]) {
        return partsA[i] - partsB[i];
      }
    }

    return 0;
  });

  // now we link all tutorials together
  for (const [i, lesson] of lessons.entries()) {
    const prevLesson = i > 0 ? lessons.at(i - 1) : undefined;
    const nextLesson = lessons.at(i + 1);

    const partMetadata = _tutorial[lesson.part].data;
    const chapterMetadata = _tutorial[lesson.part].chapters[lesson.chapter].data;

    lesson.data = {
      ...pick([lesson.data, chapterMetadata, partMetadata, tutorialMetaData], ['mainCommand', 'prepareCommands']),
      ...lesson.data,
    };

    if (prevLesson) {
      lesson.prev = {
        data: prevLesson.data,
        href: `/${_tutorial[prevLesson.part].slug}/${_tutorial[prevLesson.part].chapters[prevLesson.chapter].slug}/${
          prevLesson.slug
        }`,
      };
    }

    if (nextLesson) {
      lesson.next = {
        data: nextLesson.data,
        href: `/${_tutorial[nextLesson.part].slug}/${_tutorial[nextLesson.part].chapters[nextLesson.chapter].slug}/${
          nextLesson.slug
        }`,
      };
    }
  }

  // console.log(inspect(_tutorial, undefined, Infinity, true));

  return _tutorial;
}

function pick<T extends Record<any, any>>(objects: (T | undefined)[], properties: (keyof T)[]) {
  const newObject = {} as any;

  for (const property of properties) {
    for (const object of objects) {
      if (object?.hasOwnProperty(property)) {
        newObject[property] = object[property];
        break;
      }
    }
  }

  return newObject;
}

function parseId(id: string) {
  const [part, chapter, lesson] = id.split('/');

  const [partId] = part.split('-');
  const [chapterId] = chapter?.split('-') ?? [];
  const [lessonId] = lesson?.split('-') ?? [];

  return [partId, chapterId, lessonId];
}

function getSlug(entry: CollectionEntry) {
  let slug: string = entry.slug;

  if (entry.slug.includes('/')) {
    const parts = entry.slug.split('/');
    const _slug = parts.at(-2);

    if (!_slug) {
      throw new Error('Invalid slug');
    }

    slug = _slug;
  }

  return slug;
}

async function createFileMap(dir: string) {
  const filePaths = await glob(`${dir}/**/*`, {
    onlyFiles: true,
  });

  const files: Files = {};

  for (const filePath of filePaths) {
    files[`/${path.relative(dir, filePath)}`] = fs.readFileSync(filePath, 'utf8');
  }

  return files;
}
