import { Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Camera, FileText, ImageIcon } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";
import type { UploadFile } from "@/lib/api";

// A file the user picked, tagged with the ingest input_type the backend expects.
export type PickedFile = {
  file: UploadFile;
  inputType: "image" | "pdf" | "video";
};

// Turn an image-picker asset into an upload part. Assets carry a mimeType/fileName on modern
// SDKs; fall back to sensible defaults derived from the uri when they're absent.
function fromImageAsset(a: ImagePicker.ImagePickerAsset): PickedFile {
  const mimeType = a.mimeType || "image/jpeg";
  const name = a.fileName || a.uri.split("/").pop() || "photo.jpg";
  return { file: { uri: a.uri, name, mimeType }, inputType: "image" };
}

// The Photo / File action rows. Photo offers library + camera (each requests its own
// permission on tap — a user gesture — so opening the sheet never prompts on its own); File
// opens the document picker scoped to the same PDF/video types the web composer accepts.
export function MediaPicker({
  mode,
  onPicked,
  onError,
  disabled,
}: {
  mode: "photo" | "file";
  onPicked: (picked: PickedFile) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const { resolved } = useTheme();
  const tokens = resolved === "dark" ? dark : light;

  const pickFromLibrary = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        onError("Photo access is off. Turn it on in Settings, then try again.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (res.canceled || !res.assets?.[0]) return;
      onPicked(fromImageAsset(res.assets[0]));
    } catch {
      onError("Couldn't open your photos. Please try again.");
    }
  };

  const takePhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        onError("Camera access is off. Turn it on in Settings, then try again.");
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ quality: 0.9 });
      if (res.canceled || !res.assets?.[0]) return;
      onPicked(fromImageAsset(res.assets[0]));
    } catch {
      onError("Couldn't open the camera. Please try again.");
    }
  };

  const pickDocument = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "video/*"],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const mimeType = (a.mimeType || "").toLowerCase();
      const inputType =
        mimeType === "application/pdf" ? "pdf" : mimeType.startsWith("video/") ? "video" : null;
      if (!inputType) {
        onError("Pick a PDF or a video file.");
        return;
      }
      onPicked({
        file: { uri: a.uri, name: a.name || "upload", mimeType },
        inputType,
      });
    } catch {
      onError("Couldn't open the file picker. Please try again.");
    }
  };

  const row =
    "flex-row items-center gap-3 rounded-2xl border border-border bg-paper px-4 py-3.5";

  if (mode === "photo") {
    return (
      <View className="gap-2.5">
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={pickFromLibrary}
          className={row}
        >
          <ImageIcon size={20} color={tokens.product} />
          <Text className="text-base font-medium text-ink">Choose from library</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={takePhoto}
          className={row}
        >
          <Camera size={20} color={tokens.product} />
          <Text className="text-base font-medium text-ink">Take a photo</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={pickDocument}
      className={row}
    >
      <FileText size={20} color={tokens.product} />
      <View className="flex-1">
        <Text className="text-base font-medium text-ink">Choose a file</Text>
        <Text className="text-xs text-ink-soft">PDF or video</Text>
      </View>
    </Pressable>
  );
}
