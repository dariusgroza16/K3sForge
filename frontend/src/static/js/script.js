function runCommand() {
    let command = document.getElementById("command").value;
    fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "command=" + encodeURIComponent(command)
    })
    .then(response => response.json())
    .then(data => {
        document.getElementById("output").innerText = data.output;
    });
}

function runPredefinedCommand() {
    // Predefined command
    let predefinedCommand = "ls";  // You can change this to any command you want
    fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "command=" + encodeURIComponent(predefinedCommand)
    })
    .then(response => response.json())
    .then(data => {
        document.getElementById("output").innerText = data.output;
    });
}
