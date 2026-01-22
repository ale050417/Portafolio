//animacion
var typed = new Typed("#typed", {
    strings: ["Junior Software Developer", "Desarrollo web y móvil", "Aprender · Practicar · Construir"],
    typeSpeed: 50,
    backSpeed: 20,
    backDelay: 3000,
    showCursor: false,
    loop: true
});

//funcion para claro o oscuro de los mensajes
function getSwalTheme() {
    const isLight = document.body.classList.contains('light');

    return {
        background: isLight ? '#ffffff' : '#111a2c',
        color: isLight ? '#1D3A41' : '#DBDBDB',
        confirmButtonColor: '#4FC6CE',
        customClass: {
            popup: 'swal-rounded'
        }
    };
}



//tema
function theme() {
    const darkBtn = document.getElementById('darkBtn');
    const lightBtn = document.getElementById('lightBtn');

    document.body.classList.toggle('light');

    if (document.body.classList.contains('light')) {
        darkBtn.style.display = 'block';
        lightBtn.style.display = 'none';
    } else {
        darkBtn.style.display = 'none';
        lightBtn.style.display = 'block';
    }
}

const graph = document.getElementById("activityGraph");

const today = new Date().toISOString().split("T")[0];

//menu
const menuItems = document.querySelectorAll('.nav .item');

menuItems.forEach(item => {
    item.addEventListener('click', () => {
        menuItems.forEach(item => item.classList.remove('active'));
        item.classList.add('active');
    })
})
// Smooth scroll dentro del contenedor .content .wrapper
document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();

        const targetId = link.getAttribute('href');
        const targetEl = document.querySelector(targetId);
        const wrapper = document.querySelector('.content .wrapper');

        if (!targetEl || !wrapper) return;

        // Distancia del target dentro del wrapper
        const top = targetEl.offsetTop;

        wrapper.scrollTo({
            top: top - 100, // si queremos margen arriba hay que ajustar
            behavior: 'smooth'
        });
    });
});


const form = document.getElementById("contactForm");

if (form) {
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        Swal.fire({
            title: 'Enviando...',
            text: 'Por favor, esperá un momento.',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading(),
            ...getSwalTheme()
        });



        const formData = {
            name: form.name.value.trim(),
            email: form.email.value.trim(),
            subject: form.subject.value.trim(),
            message: form.message.value.trim(),
        };

        try {
            const res = await fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });

            const raw = await res.text();

            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch (_) {
            }

            if (!res.ok) {
                const msg = data.error || raw?.slice(0, 120) || "Error al enviar.";
                throw new Error(msg);
            }


            Swal.fire({
                icon: 'success',
                title: 'Mensaje enviado',
                html: `
                    <p style="margin:0">
                    Gracias por contactarme.<br>
                    Te responderé a la brevedad.
                    </p>
                `,
                iconColor: '#4FC6CE',
                confirmButtonText: 'Perfecto',
                ...getSwalTheme()
            });


            form.reset();
        } catch (err) {
            Swal.fire({
                icon: 'error',
                title: 'No se pudo enviar',
                html: `
                    <p style="margin:0">
                    ${err.message || 'Ocurrió un problema al enviar el mensaje.'}
                    </p>
                `,
                iconColor: '#ff6b6b',
                confirmButtonText: 'Entendido',
                ...getSwalTheme()
            });
        }
    });
}

//grafico de git
async function loadGithubContributions() {
  try {
    const graph = document.getElementById("activityGraph");
    if (!graph) return;

    const res = await fetch("/api/github-contributions");
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "No se pudo cargar contribuciones.");

    // Ajustes del gráfico
    if (data.rangeStart) graph.setAttribute("range-start", data.rangeStart);
    if (data.rangeEnd) graph.setAttribute("range-end", data.rangeEnd);

    // IMPORTANTÍSIMO: esto es lo que dibuja los cuadraditos
    graph.setAttribute("activity-data", data.activityData);

    // Niveles (como capeamos a 10, tiene sentido esto)
    graph.setAttribute("activity-levels", "0,1,2,4,7");
  } catch (e) {
    console.log("GitHub contributions error:", e.message);
  }
}

loadGithubContributions();
