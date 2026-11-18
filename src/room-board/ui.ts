// Dialog chrome is re-exported by the SDK since 1.9.0. Importing it from
// "@glasshome/ui/solid" directly is deprecated and breaks on 1.12.
import {
  Button,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  SchemaForm,
} from "@glasshome/widget-sdk";

export const widgetDialogProps = {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  Button,
  SchemaForm,
};
