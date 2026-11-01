using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class Program {
    [STAThread]
    private static int Main(string[] args) {
        string resultFile = args.Length > 1 ? args[1] : null;
        IFileOpenDialog dialog = null;
        try {
            Application.EnableVisualStyles();
            dialog = (IFileOpenDialog)new FileOpenDialog();
            dialog.SetOptions(0x20 | 0x40 | 0x800 | 0x8); // folders, filesystem, existing path, keep current directory
            dialog.SetTitle("选择 Telegram 文件的保存位置");
            dialog.SetOkButtonLabel("选择此文件夹");
            if (args.Length > 0 && Directory.Exists(args[0])) {
                IShellItem item;
                Guid iid = typeof(IShellItem).GUID;
                if (SHCreateItemFromParsingName(args[0], IntPtr.Zero, ref iid, out item) == 0) {
                    try { dialog.SetFolder(item); } finally { Marshal.ReleaseComObject(item); }
                }
            }
            int result = dialog.Show(IntPtr.Zero);
            if (result == unchecked((int)0x800704C7)) return 2;
            Marshal.ThrowExceptionForHR(result);
            IShellItem selected;
            dialog.GetResult(out selected);
            try {
                IntPtr name;
                selected.GetDisplayName(0x80058000, out name);
                try { if (resultFile != null) File.WriteAllText(resultFile, Marshal.PtrToStringUni(name), new UTF8Encoding(false)); }
                finally { Marshal.FreeCoTaskMem(name); }
            } finally { Marshal.ReleaseComObject(selected); }
            return 0;
        } catch (Exception error) { if (resultFile != null) File.WriteAllText(resultFile, error.Message, new UTF8Encoding(false)); return 1; }
        finally { if (dialog != null) Marshal.ReleaseComObject(dialog); }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(string path, IntPtr bindContext, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IShellItem item);

    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    private class FileOpenDialog { }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint nameType, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem item, uint hint, out int order);
    }

    [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr types);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem selection);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem result);
        void AddPlace(IShellItem item, uint alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
        void GetResults(out IntPtr results);
        void GetSelectedItems(out IntPtr items);
    }
}
