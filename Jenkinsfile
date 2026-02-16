pipeline {
    agent any
    tools { git 'git' }
    options { skipDefaultCheckout(true) }

    parameters {
        string(
            name: 'IMAGE_TAG',
            defaultValue: 'latest',
            description: 'Docker image TAG (np. v1.0.0)'
        )
    }
    stages {
        stage('Prepare Git') {
            steps {
                sh '''
                set -eux
                # Diagnostics
                id || true
                ls -ld "$WORKSPACE" || true
                # Fixing problem "dubious ownership"
                git config --global --add safe.directory '*'
                git config --global --list | grep safe.directory || true
                '''
            }
        }
        stage('Checkout') {
            steps {
                checkout([
                $class: 'GitSCM',
                userRemoteConfigs: [[
                    url: 'https://github.com/ranji94/poi-crawler.git',
                    credentialsId: 'github-token'
                ]],
                branches: [[name: '*/develop']],
                extensions: [
                    [$class: 'WipeWorkspace'],               
                    [$class: 'PruneStaleBranch'],             
                    [$class: 'CloneOption', shallow: false] 
                ]
                ])
            }
        }
        stage('Build Docker image') {
            steps {
                script {
                    sh '''
                    docker build -t poi-crawler:${IMAGE_TAG} .
                    docker tag poi-crawler:${IMAGE_TAG} poi-crawler:latest
                    '''
                }
            }
        }
        stage('Remove old images') {
            steps {
                sh '''
                echo "Removing untagged images..."
                docker image prune -f
                '''
            }
        }
    }
}
