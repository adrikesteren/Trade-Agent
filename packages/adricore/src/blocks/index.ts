/**
 * Adricore blocks — public surface.
 *
 * Components are organised in `components/<category>/` (atomic) and
 * `patterns/<name>/` (composed templates). Names are stable; callers always
 * import from `@repo/adricore/blocks`.
 */

export { cx } from "./lib/cx";

/* ——— Components: actions ——— */
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  LinkText,
  type LinkTextProps,
  menuTriggerPlainClass,
} from "./components/actions";

/* ——— Components: forms ——— */
export {
  Checkbox,
  type CheckboxProps,
  FieldRenderer,
  FormElement,
  type FormElementProps,
  Input,
  type InputProps,
  Lookup,
  type LookupProps,
  Select,
  type SelectProps,
  Switch,
  type SwitchProps,
  Textarea,
  type TextareaProps,
} from "./components/forms";

/* ——— Components: feedback ——— */
export {
  Alert,
  type AlertProps,
  type AlertTone,
  Badge,
  type BadgeProps,
  type BadgeTone,
  Spinner,
  type SpinnerProps,
} from "./components/feedback";

/* ——— Components: data display ——— */
export {
  ListViewObjectIcon,
  type ListViewObjectIconProps,
  Output,
  type OutputLookup,
  type OutputProps,
  type OutputPropsDatetime,
  type OutputPropsOther,
  type OutputRecordLink,
  type OutputType,
  Table,
  TableWrap,
  Td,
  Th,
} from "./components/data-display";

/* ——— Components: layout ——— */
export {
  Breadcrumbs,
  type BreadcrumbsProps,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  type CardBodyProps,
  type CardFooterProps,
  type CardHeaderProps,
  type CardProps,
  type Crumb,
  Stack,
  type StackProps,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./components/layout";

/* ——— Components: overlays ——— */
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
} from "./components/overlays";

/* ——— Patterns: app shell ——— */
export { AppHeader, AppMain, AppShell, type AppHeaderProps } from "./patterns/app-shell";

/* ——— Patterns: page header ——— */
export {
  PageHeader,
  PageHeaderDetail,
  PageHeaderList,
  type PageHeaderProps,
  type PageHeaderVariant,
} from "./patterns/page-header";

/* ——— Patterns: list view ——— */
export {
  ListViewIconButton,
  type ListViewIconButtonProps,
  ListViewLayout,
  type ListViewLayoutProps,
  ListViewPlaceholderToolbar,
  ListViewSearch,
  type ListViewSearchProps,
  ListViewTitlePickerPlaceholder,
  ListViewToolbar,
  type ListViewToolbarProps,
  listViewOutlineActionClass,
} from "./patterns/list-view";

/* ——— Patterns: record page ——— */
export {
  DetailPageLayout,
  type DetailPageLayoutProps,
  RecordPageCard,
  type RecordPageCardProps,
  RecordPageGrid,
  type RecordPageGridProps,
  RecordPageLayout,
  type RecordPageLayoutProps,
  RecordPageSection,
  type RecordPageSectionProps,
  RecordRelatedList,
  type RecordRelatedListProps,
} from "./patterns/record-page";
