from flask import Flask, render_template

from inventory import inventory_bp
from installer import installer_bp
from uninstaller import uninstaller_bp
from kubectl import kubectl_bp

app = Flask(__name__)

app.register_blueprint(inventory_bp)
app.register_blueprint(installer_bp)
app.register_blueprint(uninstaller_bp)
app.register_blueprint(kubectl_bp)


@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
