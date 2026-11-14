import {
  LuTrophy, LuStar, LuListChecks, LuBot, LuUsers, LuLayoutDashboard, LuBuilding2, LuUserCog,
  LuChartColumn, LuArchive, LuHistory, LuBug, LuSlidersHorizontal, LuUserPlus, LuPlus, LuSearch,
  LuPencil, LuUserX, LuUserCheck, LuTrash2, LuCheck, LuLock, LuInfo, LuCalculator, LuSend, LuEye,
  LuEyeOff, LuMoon, LuSun, LuBell, LuLogOut, LuX, LuMenu, LuChevronRight, LuChevronLeft,
  LuTrendingUp, LuTrendingDown, LuCircleCheck, LuCircleAlert, LuShieldCheck, LuMessageCircle,
  LuEllipsis, LuSearchX, LuStarOff, LuPencilOff, LuDatabase, LuUnplug, LuMapPinOff, LuListTodo,
  LuUndo2, LuClock, LuTriangleAlert, LuSettings2,
  LuLink, LuExternalLink,
} from 'react-icons/lu';
import { FaWhatsapp, FaInstagram, FaLinkedin, FaFacebook } from 'react-icons/fa';

const MAP = {
  trophy: LuTrophy, star: LuStar, checklist: LuListChecks, bot: LuBot, users: LuUsers,
  dashboard: LuLayoutDashboard, building: LuBuilding2, manager: LuUserCog, chart: LuChartColumn,
  archive: LuArchive, history: LuHistory, bug: LuBug, sliders: LuSlidersHorizontal,
  'user-plus': LuUserPlus, plus: LuPlus, search: LuSearch, edit: LuPencil, 'user-off': LuUserX,
  'user-check': LuUserCheck, trash: LuTrash2, check: LuCheck, lock: LuLock, info: LuInfo,
  calculator: LuCalculator, send: LuSend, eye: LuEye, 'eye-off': LuEyeOff, moon: LuMoon, sun: LuSun,
  bell: LuBell, logout: LuLogOut, x: LuX, menu: LuMenu, 'chevron-right': LuChevronRight,
  'chevron-left': LuChevronLeft, 'trending-up': LuTrendingUp, 'trending-down': LuTrendingDown,
  'circle-check': LuCircleCheck, alert: LuCircleAlert, shield: LuShieldCheck, chat: LuMessageCircle,
  dots: LuEllipsis, 'search-off': LuSearchX, 'star-off': LuStarOff, 'edit-off': LuPencilOff,
  'db-off': LuDatabase, unplug: LuUnplug, 'map-off': LuMapPinOff, list: LuListTodo, undo: LuUndo2,
  link: LuLink, external: LuExternalLink, todo: LuListTodo,
  whatsapp: FaWhatsapp, instagram: FaInstagram, linkedin: FaLinkedin, facebook: FaFacebook,
  clock: LuClock, warn: LuTriangleAlert, settings: LuSettings2,
};

/** Decorative icon (aria-hidden). Size follows the surrounding font-size. */
export default function Icon({ name, className = '' }) {
  const C = MAP[name] || LuInfo;
  return <i className={`ic ${className}`.trim()} aria-hidden="true"><C size="1em" /></i>;
}
